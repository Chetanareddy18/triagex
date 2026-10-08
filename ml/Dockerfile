FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# Slim by default (stateless hashing embeddings). Build with
#   --build-arg WITH_TRANSFORMERS=true
# to add sentence-transformers (CPU torch, ~1 GB larger).
ARG WITH_TRANSFORMERS=false
COPY requirements.txt requirements-embeddings.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
 && if [ "$WITH_TRANSFORMERS" = "true" ]; then \
      pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
      && pip install --no-cache-dir -r requirements-embeddings.txt; \
    fi
COPY triagex_ml triagex_ml
COPY models models
ENV EMBEDDING_BACKEND=auto PORT=8000
RUN useradd --create-home app && chown -R app /app
USER app
EXPOSE 8000
CMD ["sh", "-c", "uvicorn triagex_ml.api:app --host 0.0.0.0 --port ${PORT}"]
