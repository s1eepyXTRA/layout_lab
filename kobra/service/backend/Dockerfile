# Кобра: интерфейс и API в одном образе.
#
# Интерфейс собирается офлайн-вариантом — со всеми библиотеками внутри файла.
# Это не прихоть: в закрытом контуре до jsdelivr не достучаться, и сборка с CDN
# открылась бы пустым экраном. Заодно версия интерфейса не может разойтись с
# версией API: это одна и та же строка в теге образа.
#
# Собирать из корня репозитория:
#   docker build -f kobra/service/backend/Dockerfile -t kobra:dev .

FROM python:3.12-slim AS front
WORKDIR /src
COPY kobra/build.py kobra/build.py
COPY kobra/src kobra/src
COPY kobra/vendor kobra/vendor
RUN python kobra/build.py offline && mkdir -p /front && cp kobra/build/kobra.html /front/index.html

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    KOBRA_FRONTEND_DIR=/app/frontend
WORKDIR /app

# Зависимости отдельным слоем: правка кода не тянет за собой переустановку
COPY kobra/service/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY kobra/service/backend/app ./app
COPY kobra/service/backend/alembic ./alembic
COPY kobra/service/backend/alembic.ini ./alembic.ini
COPY kobra/service/backend/entrypoint.sh ./entrypoint.sh
COPY --from=front /front ./frontend

# Процесс не от root: лишние права образу не нужны
RUN useradd --create-home --uid 10001 kobra \
    && mkdir -p /app/uploads && chown -R kobra /app \
    && chmod +x /app/entrypoint.sh
USER kobra

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["api"]
