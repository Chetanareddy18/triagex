"""TriageX ML service (FastAPI).

Endpoints
  GET  /health   liveness + which models / embedding backend are loaded
  GET  /metrics  research metrics produced by train.py (metrics.json)
  POST /embed    text -> normalised embedding vectors
  POST /triage   incident fields (+ similar neighbours from the API) -> predictions

The service is stateless: the Node API is the system of record, stores embeddings in
MongoDB and sends the nearest neighbours it found along with each triage request.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .embeddings import get_embedder
from .triage import Neighbor, TriageInput, load_models, triage

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("triagex.ml")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    load_models()
    if os.getenv("EMBEDDING_WARMUP", "true").lower() == "true":
        get_embedder().encode(["warm up"])
    yield


app = FastAPI(title="TriageX ML", version="1.0.0", lifespan=lifespan)


def check_key(x_ml_key: str | None = Header(default=None)) -> None:
    """Optional shared secret between the API server and the ML service."""
    expected = os.getenv("ML_API_KEY")
    if expected and x_ml_key != expected:
        raise HTTPException(status_code=401, detail="invalid ML key")


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=256)


class EmbedResponse(BaseModel):
    model: str
    dim: int
    vectors: list[list[float]]


class NeighborIn(BaseModel):
    priority: int | None = Field(default=None, ge=1, le=4)
    category: str | None = None
    similarity: float = Field(ge=-1, le=1)


class TriageRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str = Field(default="", max_length=10_000)
    channel: str | None = None
    impact: int | None = Field(default=None, ge=1, le=3)
    urgency: int | None = Field(default=None, ge=1, le=3)
    openedAt: str | None = None
    neighbors: list[NeighborIn] = Field(default_factory=list, max_length=50)


@app.get("/health")
def health() -> dict:
    models = load_models()
    embedder = get_embedder()
    return {
        "status": "ok",
        "models": sorted(k for k in models if k != "metrics"),
        "modelVersion": (models.get("metrics") or {}).get("generated_at"),
        "embedding": {"model": embedder.model, "dim": embedder.dim},
    }


@app.get("/metrics", dependencies=[Depends(check_key)])
def metrics() -> dict:
    data = load_models().get("metrics")
    if data is None:
        raise HTTPException(status_code=404, detail="metrics.json not found; run ml/train.py")
    return data


@app.post("/embed", response_model=EmbedResponse, dependencies=[Depends(check_key)])
def embed(req: EmbedRequest) -> EmbedResponse:
    embedder = get_embedder()
    started = time.perf_counter()
    vectors = embedder.encode([t[:4000] for t in req.texts])
    log.debug("embedded %d texts in %.1fms", len(req.texts), (time.perf_counter() - started) * 1000)
    return EmbedResponse(model=embedder.model, dim=int(vectors.shape[1]), vectors=vectors.round(6).tolist())


@app.post("/triage", dependencies=[Depends(check_key)])
def triage_endpoint(req: TriageRequest) -> dict:
    result = triage(
        TriageInput(
            title=req.title,
            description=req.description,
            channel=req.channel,
            impact=req.impact,
            urgency=req.urgency,
            opened_at=req.openedAt,
            neighbors=[Neighbor(**n.model_dump()) for n in req.neighbors],
        )
    )
    return result
