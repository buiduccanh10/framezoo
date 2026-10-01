FROM python:3.11-slim@sha256:e41613d42d4891e4930f79523f93f81bbc7632584ec65e36ab055f41a800b41e

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY moonshine-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY moonshine-service/app.py ./app.py
COPY moonshine-service/limiter.py ./limiter.py
COPY moonshine-service/alignment.py ./alignment.py
COPY moonshine-service/model_runtime.py ./model_runtime.py

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
