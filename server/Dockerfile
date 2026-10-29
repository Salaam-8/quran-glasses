FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/models/hf
WORKDIR /app

# torch (CPU) and transformers are only needed once, to convert the Quran Whisper model to CTranslate2.
COPY requirements.txt .
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

COPY asr_server.py entrypoint.sh ./
RUN chmod +x entrypoint.sh

VOLUME /models
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8765/health')" || exit 1
CMD ["./entrypoint.sh"]
