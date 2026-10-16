# syntax=docker/dockerfile:1.7
# One image for the whole application (solution.md §19, D-14): the built web app, the API and
# the MCP tool server as two processes. FalkorDB runs as its own container (docker-compose.yml).
# Base images are pinned by digest.

# --- 1. the web app ------------------------------------------------------------------------------
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ENV VITE_API_MODE=http
RUN npm run build

# --- 2. the Python runtime -----------------------------------------------------------------------
FROM ghcr.io/astral-sh/uv:0.12.17@sha256:10787c682e4184e4f290de1171fd4703dc63de99221f10fe1c99002ce7fa9acc AS uv

FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1 AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/src ./src
RUN uv sync --frozen --no-dev --no-editable
COPY --from=web /web/dist /app/frontend/dist
COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod 0755 /app/entrypoint.sh && useradd --create-home --uid 10001 interdict
USER interdict
ARG GIT_SHA=dev
ENV PATH="/app/backend/.venv/bin:${PATH}" \
    INTERDICT_STATIC_DIR=/app/frontend/dist \
    INTERDICT_GIT_SHA=${GIT_SHA}
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=40s --retries=6 \
    CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=2).status == 200 else 1)"
ENTRYPOINT ["/app/entrypoint.sh"]
