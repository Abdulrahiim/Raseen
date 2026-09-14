FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RASEEN_SITE_MODE=real RASEEN_CACHE_DIR=/app/.cache
COPY pyproject.toml README.md ./
COPY raseen ./raseen
RUN pip install --no-cache-dir . && mkdir -p /app/.cache
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/status')" || exit 1
CMD ["sh", "-c", "uvicorn raseen.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
