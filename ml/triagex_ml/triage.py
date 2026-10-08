"""Triage inference: priority, category, SLA-breach risk and resolution-time estimate.

Signals combined for **priority** (each returns a distribution over P1..P4):

1. ``itil``      -- the ITIL impact x urgency matrix (exactly the rule that generates
                    priority in the UCI data; see docs/RESEARCH.md).
2. ``neighbors`` -- similarity-weighted vote of the most similar past incidents in
                    TriageX, using the priority agents finally settled on.
3. ``lexicon``   -- severity keywords in the title/description ("outage", "data loss").

**Category** uses the neighbor vote plus a keyword classifier.
**Breach risk** and **resolution hours** come from the UCI-trained app-compatible
models (``models/*.joblib``), fed with the suggested priority.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np

from .features import app_payload_to_frame

log = logging.getLogger("triagex.ml.triage")

MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
PRIORITIES = [1, 2, 3, 4]
CATEGORIES = ["network", "hardware", "software", "access", "database", "security", "email", "other"]

# Weights of each signal when blending priority distributions.
SIGNAL_WEIGHTS = {"itil": 0.45, "neighbors": 0.35, "lexicon": 0.20}
MIN_NEIGHBOR_SIMILARITY = 0.35

SEVERITY_LEXICON: dict[int, list[str]] = {
    1: [
        "outage",
        "down for everyone",
        "all users",
        "production down",
        "prod down",
        "data loss",
        "ransomware",
        "breach",
        "cannot process payments",
        "payments failing",
        "site down",
        "service unavailable",
        "critical",
        "sev1",
        "p1",
        "entire",
        "whole company",
    ],
    2: [
        "degraded",
        "slow",
        "intermittent",
        "multiple users",
        "timeout",
        "timeouts",
        "errors",
        "failing",
        "cannot login",
        "can't log in",
        "locked out",
        "vpn",
        "deadline",
        "customer facing",
    ],
    4: [
        "cosmetic",
        "typo",
        "request",
        "how do i",
        "question",
        "nice to have",
        "when possible",
        "minor",
        "feature",
        "suggestion",
        "low priority",
        "new laptop",
        "access request",
    ],
}

CATEGORY_LEXICON: dict[str, list[str]] = {
    "network": [
        "vpn",
        "wifi",
        "wi-fi",
        "network",
        "dns",
        "latency",
        "packet",
        "router",
        "switch",
        "firewall rule",
        "bandwidth",
        "proxy",
    ],
    "hardware": [
        "laptop",
        "monitor",
        "keyboard",
        "printer",
        "battery",
        "disk",
        "hardware",
        "dock",
        "screen",
        "mouse",
        "headset",
    ],
    "software": [
        "crash",
        "bug",
        "install",
        "update",
        "application",
        "app ",
        "error message",
        "excel",
        "browser",
        "release",
        "deploy",
        "build",
    ],
    "access": [
        "password",
        "login",
        "log in",
        "sso",
        "permission",
        "access",
        "mfa",
        "2fa",
        "account locked",
        "locked out",
        "role",
    ],
    "database": [
        "database",
        "db ",
        "query",
        "postgres",
        "mysql",
        "mongo",
        "replication",
        "deadlock",
        "index",
        "backup",
        "sql",
    ],
    "security": [
        "phishing",
        "malware",
        "ransomware",
        "breach",
        "suspicious",
        "virus",
        "vulnerability",
        "cve",
        "leak",
        "unauthorized",
    ],
    "email": ["email", "e-mail", "outlook", "mailbox", "smtp", "inbox", "calendar", "spam"],
}


@dataclass
class Neighbor:
    priority: int | None = None
    category: str | None = None
    similarity: float = 0.0


@dataclass
class TriageInput:
    title: str
    description: str = ""
    channel: str | None = None
    impact: int | None = None
    urgency: int | None = None
    opened_at: str | None = None
    neighbors: list[Neighbor] = field(default_factory=list)


def itil_priority(impact: int | None, urgency: int | None) -> int | None:
    """ITIL matrix used by the source data: 1+1 -> P1, sum 3 -> P2, sum 4 -> P3, else P4."""
    if impact is None or urgency is None:
        return None
    total = int(impact) + int(urgency)
    if total <= 2:
        return 1
    if total == 3:
        return 2
    if total == 4:
        return 3
    return 4


def _one_hot(priority: int) -> np.ndarray:
    vec = np.zeros(4)
    vec[priority - 1] = 1.0
    return vec


def _contains(text: str, phrase: str) -> bool:
    return re.search(r"(?<![a-z0-9])" + re.escape(phrase.strip()) + r"(?![a-z0-9])", text) is not None


def lexicon_priority(text: str) -> tuple[np.ndarray | None, list[str]]:
    lowered = text.lower()
    hits: dict[int, list[str]] = {
        p: [w for w in words if _contains(lowered, w)] for p, words in SEVERITY_LEXICON.items()
    }
    scores = np.zeros(4)
    for p, words in hits.items():
        scores[p - 1] += len(words)
    if scores.sum() == 0:
        return None, []
    # A matched severity level also lends a little mass to its neighbour level.
    spill = np.zeros(4)
    spill[1:] += scores[:-1]  # P(n) lends to P(n+1) ...
    spill[:-1] += scores[1:]  # ... and to P(n-1), without wrapping around
    smoothed = scores + 0.25 * spill
    return smoothed / smoothed.sum(), sorted({w for ws in hits.values() for w in ws})


def neighbor_vote(neighbors: list[Neighbor], attr: str, labels: list) -> tuple[np.ndarray | None, float]:
    useful = [n for n in neighbors if n.similarity >= MIN_NEIGHBOR_SIMILARITY and getattr(n, attr) in labels]
    if not useful:
        return None, 0.0
    scores = np.zeros(len(labels))
    for n in useful:
        scores[labels.index(getattr(n, attr))] += n.similarity**2
    support = float(sum(n.similarity for n in useful))
    return scores / scores.sum(), support


def keyword_category(text: str) -> tuple[np.ndarray | None, list[str]]:
    lowered = f" {text.lower()} "
    scores = np.zeros(len(CATEGORIES))
    hits: list[str] = []
    for cat, words in CATEGORY_LEXICON.items():
        matched = [w for w in words if w in lowered]
        scores[CATEGORIES.index(cat)] += len(matched)
        hits += matched
    if scores.sum() == 0:
        return None, []
    return scores / scores.sum(), sorted(set(hits))


@lru_cache(maxsize=1)
def load_models() -> dict:
    models: dict = {}
    for name in ("breach_app", "resolution_app"):
        path = MODELS_DIR / f"{name}.joblib"
        if path.exists():
            models[name] = joblib.load(path)
        else:  # pragma: no cover - only when train.py has not been run
            log.warning("model %s missing; run ml/train.py", path)
    metrics_path = MODELS_DIR / "metrics.json"
    models["metrics"] = json.loads(metrics_path.read_text()) if metrics_path.exists() else None
    return models


def triage(inp: TriageInput) -> dict:
    text = f"{inp.title}\n{inp.description or ''}"
    signals: dict[str, dict] = {}
    blend = np.zeros(4)
    total_weight = 0.0

    itil = itil_priority(inp.impact, inp.urgency)
    if itil is not None:
        blend += SIGNAL_WEIGHTS["itil"] * _one_hot(itil)
        total_weight += SIGNAL_WEIGHTS["itil"]
        signals["itil"] = {"priority": itil, "impact": inp.impact, "urgency": inp.urgency}

    nb_dist, support = neighbor_vote(inp.neighbors, "priority", PRIORITIES)
    if nb_dist is not None:
        # Scale the neighbour weight by how much similar evidence exists (saturates at 2.0).
        w = SIGNAL_WEIGHTS["neighbors"] * min(1.0, support / 2.0)
        blend += w * nb_dist
        total_weight += w
        signals["neighbors"] = {"distribution": nb_dist.round(3).tolist(), "support": round(support, 3)}

    lex_dist, lex_hits = lexicon_priority(text)
    if lex_dist is not None:
        blend += SIGNAL_WEIGHTS["lexicon"] * lex_dist
        total_weight += SIGNAL_WEIGHTS["lexicon"]
        signals["lexicon"] = {"distribution": lex_dist.round(3).tolist(), "matches": lex_hits}

    if total_weight == 0:
        dist = np.array([0.05, 0.15, 0.6, 0.2])  # prior when nothing is known
        signals["prior"] = {"note": "no impact/urgency, keywords or similar incidents"}
    else:
        dist = blend / total_weight
    priority = int(np.argmax(dist)) + 1

    cat_scores = np.zeros(len(CATEGORIES))
    cat_nb, cat_support = neighbor_vote(inp.neighbors, "category", CATEGORIES)
    if cat_nb is not None:
        cat_scores += 0.6 * min(1.0, cat_support / 2.0) * cat_nb
    cat_kw, cat_hits = keyword_category(text)
    if cat_kw is not None:
        cat_scores += 0.4 * cat_kw
    if cat_scores.sum() == 0:
        category, category_conf = "other", 0.0
    else:
        cat_dist = cat_scores / cat_scores.sum()
        category = CATEGORIES[int(np.argmax(cat_dist))]
        category_conf = float(cat_dist.max())

    models = load_models()
    frame = app_payload_to_frame(
        {
            "channel": inp.channel,
            "impact": inp.impact,
            "urgency": inp.urgency,
            "priority": priority,
            "openedAt": inp.opened_at,
        }
    )
    breach_risk = None
    if "breach_app" in models:
        breach_risk = float(models["breach_app"].predict_proba(frame)[0, 1])
    resolution_hours = None
    if "resolution_app" in models:
        resolution_hours = float(np.expm1(models["resolution_app"].predict(frame)[0]))

    return {
        "priority": priority,
        "priorityConfidence": round(float(dist.max()), 4),
        "priorityDistribution": [round(float(x), 4) for x in dist],
        "category": category,
        "categoryConfidence": round(category_conf, 4),
        "categoryKeywords": cat_hits,
        "breachRisk": None if breach_risk is None else round(breach_risk, 4),
        "expectedResolutionHours": None if resolution_hours is None else round(max(resolution_hours, 0.0), 2),
        "signals": signals,
        "modelVersion": (models.get("metrics") or {}).get("generated_at", "untrained"),
    }
