FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    ALIGN_MODEL=small \
    ALIGN_MODEL_DIR=/models \
    ALIGN_CPU_THREADS=4 \
    ALIGN_FFMPEG_TIMEOUT_SECONDS=120

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

RUN mkdir -p /models

EXPOSE 3200

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "3200"]
