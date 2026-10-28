"""Приём файла и состояние разбора.

Файл не разбирается в запросе: сотни тысяч строк — это минуты, и держать на них
HTTP-соединение значит привязать загрузку к открытой вкладке. Поэтому запрос
делает ровно две вещи: кладёт файл во временное хранилище потоком и ставит
задачу в очередь.
"""
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.access import can_edit, why_read_only
from app.auth import current_user
from app.core import Dataset, User
from app.db import get_db
from app.ingest import ingest_file
from app.queue import redis_ok, task_get, task_set

router = APIRouter(prefix="/api", tags=["upload"])

UPLOAD_DIR = os.environ.get("KOBRA_UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "..", "uploads"))
CHUNK = 1024 * 1024
MAX_FILE_MB = int(os.environ.get("KOBRA_MAX_FILE_MB", "512"))


@router.post("/datasets/{ds_id}/file")
async def upload_file(ds_id: str, file: UploadFile = File(...), db: Session = Depends(get_db),
                      user: User = Depends(current_user)):
    ds = db.get(Dataset, ds_id)
    if ds is None:
        raise HTTPException(status_code=404, detail="Набор не найден")
    if not can_edit(user, ds):
        raise HTTPException(status_code=403, detail=why_read_only(ds))
    if not redis_ok():
        # Честный отказ лучше, чем принять файл и молча ничего не сделать
        raise HTTPException(status_code=503, detail="Фоновая обработка сейчас недоступна, попробуйте позже")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    task_id = uuid.uuid4().hex
    path = os.path.join(UPLOAD_DIR, f"{task_id}_{os.path.basename(file.filename or 'file')}")
    size = 0
    with open(path, "wb") as out:
        while True:
            chunk = await file.read(CHUNK)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_FILE_MB * 1024 * 1024:
                out.close()
                os.remove(path)
                raise HTTPException(status_code=413, detail=f"Файл больше {MAX_FILE_MB} МБ")
            out.write(chunk)

    task_set(task_id, state="queued", rows=0, dataset=ds_id, file=file.filename, bytes=size)
    ingest_file.delay(task_id, ds_id, path, file.filename or "file.csv", user.username)
    return {"task": task_id, "bytes": size}


@router.get("/tasks/{task_id}")
def read_task(task_id: str, _user: User = Depends(current_user)):
    """Состояние задачи: `queued` → `running` со счётчиком строк → `done` или
    `error` с причиной. Это то, что человек видит на странице данных."""
    state = task_get(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Задача не найдена или её состояние устарело")
    return state
