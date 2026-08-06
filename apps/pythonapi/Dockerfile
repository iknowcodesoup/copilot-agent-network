FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/root/.cache/huggingface
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv

COPY apps/pythonapi/pyproject.toml ./pyproject.toml
COPY apps/pythonapi/README.md ./README.md
COPY apps/pythonapi/uv.lock ./uv.lock
COPY apps/pythonapi/pythonapi ./pythonapi
RUN uv sync --no-dev

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "pythonapi.main:app", "--host", "0.0.0.0", "--port", "8000"]