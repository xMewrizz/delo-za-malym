FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend ./
RUN npm run build

FROM python:3.13-slim@sha256:d98cc29d3266e535dd9da1099688d9cb3ca4753813571e071763d17725460962

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATABASE_PATH=/app/data/cabinet.sqlite3

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --require-hashes -r requirements.txt \
    && useradd --uid 10001 --create-home cabinet \
    && mkdir /app/data && chown cabinet:cabinet /app/data

COPY backend ./backend
COPY credit_engine ./credit_engine
COPY scripts ./scripts
COPY contracts ./contracts
COPY scr ./scr
COPY --from=frontend-build /frontend/dist ./frontend/dist

USER cabinet
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=3)"
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
