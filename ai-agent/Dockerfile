# ── builder: compile wheels for all dependencies ──────────────────────────────
FROM mcr.microsoft.com/playwright/python:v1.49.0-noble AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt


# ── runtime: Playwright base (browser deps pre-installed) + wheels ────────────
FROM mcr.microsoft.com/playwright/python:v1.49.0-noble AS runtime

WORKDIR /app

COPY --from=builder /wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links /wheels /wheels/*.whl \
    && rm -rf /wheels

RUN playwright install chromium

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
