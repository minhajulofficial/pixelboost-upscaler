FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POETRY_VERSION=1.8.5 \
    POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_CREATE=false \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir "poetry==${POETRY_VERSION}"

WORKDIR /app

# Lock file was intentionally dropped (pyproject grew new deps and poetry is
# not available in CI to regenerate it) — poetry resolves and writes a fresh
# lock at build time.
COPY pyproject.toml ./
RUN poetry install --no-root --only main

COPY app ./app

# Build-time git commit for /version. Render auto-injects RENDER_GIT_COMMIT
# at runtime, so this ARG is only used by hosts that don't (Fly.io, Railway,
# local docker build, etc.). Defaults to "unknown" — keep it that way unless
# the build is actually passing --build-arg GIT_COMMIT=...
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
