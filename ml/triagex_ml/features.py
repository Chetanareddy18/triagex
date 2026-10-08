"""Per-incident feature construction for the UCI incident event log (dataset id 498).

The raw file is an *event log*: one row per update of an incident (141,712 rows,
24,918 incidents). Training on raw rows would leak the future, because later rows
carry fields that are only known after triage (reassignment counts, closure codes,
resolver ids, ...). We therefore build one row per incident:

* **Features** come exclusively from the *first logged event* of each incident
  (lowest ``sys_mod_count``), restricted to fields an agent could know when the
  ticket is opened.
* **Targets** come from the *last logged event* (final state of the ticket).

See docs/RESEARCH.md for the full list of excluded columns and why.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

TS_FMT = "%d/%m/%Y %H:%M"

# Categorical fields known when the incident is opened (read from the first event).
OPEN_TIME_CATEGORICALS = [
    "contact_type",
    "location",
    "category",
    "subcategory",
    "u_symptom",
    "assignment_group",
    "opened_by",
]
ORDINAL_FIELDS = ["impact", "urgency", "priority"]
TIME_FEATURES = ["open_hour", "open_weekday", "open_weekend", "open_business_hours"]

# Columns deliberately never used as features (post-open information or targets).
EXCLUDED_COLUMNS = {
    "incident_state": "changes over the life of the ticket",
    "active": "derived from final state",
    "reassignment_count": "accumulates after opening",
    "reopen_count": "accumulates after opening",
    "sys_mod_count": "accumulates after opening",
    "made_sla": "target (SLA task)",
    "caller_id": "5k+ ids, identity proxy with no generalisation value",
    "sys_created_by": "46% missing, audit metadata",
    "sys_created_at": "46% missing, audit metadata",
    "sys_updated_by": "per-event metadata",
    "sys_updated_at": "per-event metadata (used only for ordering)",
    "cmdb_ci": "99.8% missing",
    "assigned_to": "set during triage",
    "knowledge": "may be set by the resolver",
    "u_priority_confirmation": "set by the agent after review",
    "notify": "near-constant",
    "problem_id": "linked after investigation",
    "rfc": "linked after investigation",
    "vendor": "linked after investigation",
    "caused_by": "100% missing",
    "closed_code": "known at closure",
    "resolved_by": "known at resolution",
    "resolved_at": "used only to compute the regression target",
    "closed_at": "known at closure",
}

# Feature sets used for the three research tasks.
#   * priority task: impact/urgency are removed because in this dataset priority is a
#     deterministic ITIL matrix of (impact, urgency) -- including them turns the task
#     into a lookup table (verified in train.py, reported in metrics.json).
FEATURES_PRIORITY = OPEN_TIME_CATEGORICALS + TIME_FEATURES
FEATURES_FULL = OPEN_TIME_CATEGORICALS + ORDINAL_FIELDS + TIME_FEATURES
# "app-compatible" subset: fields the TriageX app collects with the same semantics.
FEATURES_APP = ["contact_type"] + ORDINAL_FIELDS + TIME_FEATURES

# TriageX app channel -> dataset contact_type (documented approximation).
APP_CHANNEL_TO_CONTACT_TYPE = {
    "phone": "Phone",
    "email": "Email",
    "portal": "Self service",
    "monitoring": "Direct opening",
}
PRIORITY_LABELS = ["1 - Critical", "2 - High", "3 - Moderate", "4 - Low"]
IMPACT_LABELS = ["1 - High", "2 - Medium", "3 - Low"]


@dataclass(frozen=True)
class IncidentTable:
    frame: pd.DataFrame  # one row per incident, features + targets + opened_at

    @property
    def n(self) -> int:
        return len(self.frame)


def _level(value: object) -> float:
    """'2 - Medium' -> 2.0 ; missing -> nan."""
    if isinstance(value, str) and value[:1].isdigit():
        return float(value.split(" ", 1)[0])
    return np.nan


def load_events(csv_path: Path | str) -> pd.DataFrame:
    df = pd.read_csv(csv_path, na_values="?", low_memory=False)
    df["sys_updated_at"] = pd.to_datetime(df["sys_updated_at"], format=TS_FMT)
    df["opened_at"] = pd.to_datetime(df["opened_at"], format=TS_FMT)
    df["resolved_at"] = pd.to_datetime(df["resolved_at"], format=TS_FMT, errors="coerce")
    return df


def add_time_features(frame: pd.DataFrame, ts_col: str = "opened_at") -> pd.DataFrame:
    ts = pd.to_datetime(frame[ts_col])
    out = frame.copy()
    out["open_hour"] = ts.dt.hour.astype(int)
    out["open_weekday"] = ts.dt.weekday.astype(int)
    out["open_weekend"] = (ts.dt.weekday >= 5).astype(int)
    out["open_business_hours"] = ((ts.dt.hour >= 8) & (ts.dt.hour < 18) & (ts.dt.weekday < 5)).astype(int)
    return out


def build_incident_table(events: pd.DataFrame) -> IncidentTable:
    ordered = events.sort_values(["number", "sys_mod_count", "sys_updated_at"], kind="mergesort")
    grouped = ordered.groupby("number", sort=False)
    first = grouped.head(1).set_index("number")
    last = grouped.tail(1).set_index("number")

    table = first[OPEN_TIME_CATEGORICALS + ORDINAL_FIELDS + ["opened_at"]].copy()
    table = add_time_features(table)
    table["priority_label"] = first["priority"]
    for col in ORDINAL_FIELDS:
        table[col] = table[col].map(_level)

    # made_sla starts True and flips to False once the SLA is breached, so the
    # final event holds the outcome.
    table["breached"] = (~last["made_sla"].astype(bool)).astype(int)
    hours = (last["resolved_at"] - last["opened_at"]).dt.total_seconds() / 3600.0
    table["resolution_hours"] = hours
    table = table.sort_values("opened_at", kind="mergesort")
    return IncidentTable(frame=table)


def time_split(frame: pd.DataFrame, test_fraction: float = 0.2) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Chronological split on ``opened_at``: train on the past, test on the future."""
    frame = frame.sort_values("opened_at", kind="mergesort")
    cut = int(len(frame) * (1 - test_fraction))
    return frame.iloc[:cut].copy(), frame.iloc[cut:].copy()


def app_payload_to_frame(payload: dict) -> pd.DataFrame:
    """Map a TriageX incident (app schema) to the dataset's app-compatible features."""
    ts = pd.Timestamp(payload.get("openedAt") or pd.Timestamp.now(tz="UTC"))
    if ts.tzinfo is not None:
        ts = ts.tz_convert("UTC").tz_localize(None)

    def num(key: str) -> float:
        value = payload.get(key)
        return float(value) if value is not None else np.nan

    row = {
        "contact_type": APP_CHANNEL_TO_CONTACT_TYPE.get(str(payload.get("channel", "")).lower(), np.nan),
        "impact": num("impact"),
        "urgency": num("urgency"),
        "priority": num("priority"),
        "opened_at": ts,
    }
    return add_time_features(pd.DataFrame([row]))[FEATURES_APP]
