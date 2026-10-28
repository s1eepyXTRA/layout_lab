#!/bin/sh
# Один образ — три роли. Какая именно, говорит команда:
#   api     — веб-сервис (интерфейс и API)
#   worker  — воркер очереди: разбор загруженных файлов
#   migrate — прокатить миграции и выйти (job перед обновлением)
set -e

case "${1:-api}" in
  migrate)
    echo "Миграции: приводим схему к нужной версии…"
    exec python -m alembic upgrade head
    ;;
  worker)
    # Воркер миграций не катит: это дело одного процесса, иначе они
    # столкнутся на одной базе при одновременном старте
    exec python -m celery -A app.ingest.celery_app worker \
      --loglevel="${KOBRA_LOG_LEVEL:-info}" --concurrency="${KOBRA_WORKER_CONCURRENCY:-2}"
    ;;
  api)
    # В разработке удобно прокатывать схему тем же контейнером; в кластере это
    # делает отдельный job, и переменная остаётся выключенной
    if [ "${KOBRA_MIGRATE_ON_START:-0}" = "1" ]; then
      python -m alembic upgrade head
    fi
    exec python -m uvicorn app.main:app --host 0.0.0.0 --port "${KOBRA_PORT:-8000}" \
      --log-level "${KOBRA_LOG_LEVEL:-info}"
    ;;
  *)
    exec "$@"
    ;;
esac
