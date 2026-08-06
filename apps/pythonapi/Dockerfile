FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app
RUN pip install --no-cache-dir uv

COPY apps/pythonapi/pyproject.toml ./pyproject.toml
COPY apps/pythonapi/README.md ./README.md
COPY apps/pythonapi/uv.lock ./uv.lock
COPY apps/pythonapi/pythonapi ./pythonapi
RUN uv sync --no-dev

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "pythonapi.main:app", "--host", "0.0.0.0", "--port", "8000"]