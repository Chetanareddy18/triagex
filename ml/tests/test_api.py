from fastapi.testclient import TestClient

from triagex_ml.api import app

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["embedding"]["model"].startswith("hashing")
    assert "breach_app" in body["models"]


def test_embed_returns_unit_vectors():
    res = client.post("/embed", json={"texts": ["Disk full on db-01", "Outlook will not sync"]})
    assert res.status_code == 200
    body = res.json()
    assert len(body["vectors"]) == 2 and len(body["vectors"][0]) == body["dim"]


def test_triage_validates_input():
    assert client.post("/triage", json={"title": ""}).status_code == 422
    assert client.post("/triage", json={"title": "x", "impact": 9}).status_code == 422


def test_triage_happy_path():
    res = client.post(
        "/triage",
        json={
            "title": "Users locked out after MFA change",
            "description": "multiple users cannot login",
            "channel": "portal",
            "impact": 2,
            "urgency": 1,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["priority"] in (1, 2, 3, 4)
    assert body["category"] == "access"


def test_metrics_endpoint():
    res = client.get("/metrics")
    assert res.status_code == 200
    assert "tasks" in res.json()


def test_optional_api_key(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "secret")
    assert client.post("/embed", json={"texts": ["a"]}).status_code == 401
    assert client.post("/embed", json={"texts": ["a"]}, headers={"x-ml-key": "secret"}).status_code == 200
