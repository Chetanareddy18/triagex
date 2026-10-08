import numpy as np
import pytest

from triagex_ml.embeddings import HashingEmbedder, cosine
from triagex_ml.triage import (
    Neighbor,
    TriageInput,
    itil_priority,
    keyword_category,
    lexicon_priority,
    neighbor_vote,
    triage,
)


@pytest.mark.parametrize(
    "impact,urgency,expected",
    [(1, 1, 1), (1, 2, 2), (2, 1, 2), (2, 2, 3), (2, 3, 4), (3, 2, 4), (3, 3, 4), (None, 2, None)],
)
def test_itil_matrix_matches_dataset(impact, urgency, expected):
    assert itil_priority(impact, urgency) == expected


def test_lexicon_detects_severity_without_wrapping():
    dist, hits = lexicon_priority("Production down: payments failing for all users")
    assert dist is not None and int(np.argmax(dist)) == 0
    assert dist[3] == 0  # P1 evidence must not leak into P4
    assert "all users" in hits
    assert lexicon_priority("Lunch menu")[0] is None


def test_neighbor_vote_ignores_dissimilar():
    nbs = [Neighbor(priority=1, similarity=0.9), Neighbor(priority=4, similarity=0.1)]
    dist, support = neighbor_vote(nbs, "priority", [1, 2, 3, 4])
    assert dist.tolist() == [1.0, 0.0, 0.0, 0.0]
    assert support == pytest.approx(0.9)


def test_keyword_category():
    dist, hits = keyword_category("VPN keeps disconnecting, DNS lookups time out")
    assert dist is not None and "vpn" in hits


def test_triage_end_to_end_outputs_are_bounded():
    out = triage(
        TriageInput(
            title="Checkout API outage",
            description="Production down, payments failing for all users",
            channel="monitoring",
            impact=1,
            urgency=1,
            opened_at="2026-03-02T10:00:00Z",
            neighbors=[Neighbor(priority=1, category="software", similarity=0.8)],
        )
    )
    assert out["priority"] == 1
    assert 0 < out["priorityConfidence"] <= 1
    assert abs(sum(out["priorityDistribution"]) - 1) < 1e-3
    assert 0 <= out["breachRisk"] <= 1
    assert out["expectedResolutionHours"] >= 0
    assert set(out["signals"]) == {"itil", "neighbors", "lexicon"}


def test_triage_with_no_information_uses_prior():
    out = triage(TriageInput(title="Hello"))
    assert out["priority"] == 3
    assert "prior" in out["signals"]
    assert out["category"] == "other"


def test_hashing_embedder_similarity_orders_related_text():
    emb = HashingEmbedder()
    a, b, c = emb.encode(["VPN connection drops every hour", "VPN connection keeps dropping", "Printer out of toner"])
    assert a.shape == (emb.dim,)
    assert np.linalg.norm(a) == pytest.approx(1.0, abs=1e-5)
    assert cosine(a, b) > cosine(a, c)
