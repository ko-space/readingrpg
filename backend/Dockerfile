FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run은 컨테이너에 PORT 환경변수(기본 8080)를 주입하고, 그 포트로 리슨해야 트래픽을 받는다.
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
