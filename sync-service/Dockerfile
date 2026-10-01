FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY sync-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY sync-service/silero_vad.onnx ./silero_vad.onnx
COPY sync-service/vad.py ./vad.py
COPY sync-service/fft_align.py ./fft_align.py
COPY sync-service/split_align.py ./split_align.py
COPY sync-service/app.py ./app.py
COPY sync-service/limiter.py ./limiter.py
COPY sync-service/alignment.py ./alignment.py
COPY sync-service/model_runtime.py ./model_runtime.py

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
