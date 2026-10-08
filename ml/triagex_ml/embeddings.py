"""Text embeddings for similar-incident search.

Two interchangeable backends:

* ``sentence-transformers`` (default when installed): ``all-MiniLM-L6-v2``, 384-d,
  semantic similarity ("VPN drops" ~ "remote access disconnects").
* ``hashing``: a stateless TF-style ``HashingVectorizer`` over word uni/bi-grams and
  character 3-5-grams, L2-normalised. No fitting and no vocabulary, so vectors stay
  comparable as the corpus grows. Used when torch is unavailable (e.g. the slim
  Docker image) or when ``EMBEDDING_BACKEND=hashing``.

Every vector is returned with the backend's ``model`` id; the API server only
compares vectors produced by the same model.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache

import numpy as np
from scipy.sparse import hstack
from sklearn.feature_extraction.text import HashingVectorizer
from sklearn.preprocessing import normalize

log = logging.getLogger("triagex.ml.embeddings")

ST_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
HASHING_DIM = 512


class HashingEmbedder:
    model = f"hashing-{HASHING_DIM}-v1"
    dim = HASHING_DIM

    def __init__(self) -> None:
        word_dim = HASHING_DIM // 2
        self._word = HashingVectorizer(
            n_features=word_dim, ngram_range=(1, 2), alternate_sign=False, norm=None, stop_words="english"
        )
        self._char = HashingVectorizer(
            n_features=HASHING_DIM - word_dim, analyzer="char_wb", ngram_range=(3, 5), alternate_sign=False, norm=None
        )

    def encode(self, texts: list[str]) -> np.ndarray:
        cleaned = [t.lower() for t in texts]
        word = self._word.transform(cleaned)
        char = self._char.transform(cleaned)
        word.data = np.log1p(word.data)
        char.data = np.log1p(char.data) * 0.5  # word evidence weighs more than char overlap
        mat = normalize(hstack([word, char]).tocsr())
        return np.asarray(mat.todense(), dtype=np.float32)


class SentenceTransformerEmbedder:
    model = ST_MODEL_NAME

    def __init__(self) -> None:
        from sentence_transformers import SentenceTransformer  # heavy import, deferred

        self._st = SentenceTransformer(ST_MODEL_NAME, device="cpu")
        dim_fn = getattr(self._st, "get_embedding_dimension", None) or self._st.get_sentence_embedding_dimension
        self.dim = int(dim_fn())

    def encode(self, texts: list[str]) -> np.ndarray:
        return np.asarray(self._st.encode(texts, normalize_embeddings=True, batch_size=32), dtype=np.float32)


@lru_cache(maxsize=1)
def get_embedder() -> HashingEmbedder | SentenceTransformerEmbedder:
    backend = os.getenv("EMBEDDING_BACKEND", "auto").lower()
    if backend in ("auto", "sentence-transformers"):
        try:
            embedder = SentenceTransformerEmbedder()
            log.info("embedding backend: %s (%sd)", embedder.model, embedder.dim)
            return embedder
        except Exception as exc:  # pragma: no cover - depends on optional deps / network
            if backend == "sentence-transformers":
                raise
            log.warning("sentence-transformers unavailable (%s); falling back to hashing", exc)
    return HashingEmbedder()


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(a @ b / denom) if denom else 0.0
