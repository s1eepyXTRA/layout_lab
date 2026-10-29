"""Приём файла и состояние разбора.

Файл не разбирается в запросе: сотни тысяч строк — это минуты, и держать на них
HTTP-соединение значит привязать загрузку к открытой вкладке. Поэтому запрос
делает две вещи: принимает файл кусками и ставит задачу в очередь.

Куски ложатся в базу, а не на диск: принимает файл веб-сервис, а разбирает
воркер, и в кластере это разные поды. Общий диск потребовал бы хранилища с
ReadWriteMany, которого во многих контурах нет; база есть всегда.
"""
import os
import uuid

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.access import can_edit, why_read_only
from app.auth import current_user
from app.core import Dataset, UploadChunk, User
from app.db import get_db
from app.ingest import ingest_file
from app.queue import redis_ok, task_get, task_set

router = APIRouter(prefix="/api", tags=["upload"])

CHUNK = 1024 * 1024
MAX_FILE_MB = int(os.environ.get("KOBRA_MAX_FILE_MB", "512"))


@router.post("/datasets/{ds_id}/file")
async def upload_file(ds_id: str, file: UploadFile = File(...), columns: str = Form(""),
                      db: Session = Depends(get_db), user: User = Depends(current_user)):
    ds = db.get(Dataset, ds_id)
    if ds is None:
        raise HTTPException(status_code=404, detail="Набор не найден")
    if not can_edit(user, ds):
        raise HTTPException(status_code=403, detail=why_read_only(ds))
    if not redis_ok():
        # Честный отказ лучше, чем принять файл и молча ничего не сделать
        raise HTTPException(status_code=503, detail="Фоновая обработка сейчас недоступна, попробуйте позже")

    task_id = uuid.uuid4().hex
    size = 0
    idx = 0
    while True:
        chunk = await file.read(CHUNK)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_FILE_MB * 1024 * 1024:
            db.query(UploadChunk).filter(UploadChunk.task_id == task_id).delete()
            db.commit()
            raise HTTPException(status_code=413, detail=f"Файл больше {MAX_FILE_MB} МБ")
        db.add(UploadChunk(task_id=task_id, idx=idx, data=chunk))
        db.commit()
        idx += 1
    if not size:
        raise HTTPException(status_code=422, detail="Пустой файл")

    try:
        chosen = json.loads(columns) if columns else None
    except ValueError:
        chosen = None
    task_set(task_id, state="queued", rows=0, dataset=ds_id, file=file.filename, bytes=size)
    ingest_file.delay(task_id, ds_id, file.filename or "file.csv", user.username, chosen)
    return {"task": task_id, "bytes": size}


@router.get("/tasks/{task_id}")
def read_task(task_id: str, _user: User = Depends(current_user)):
    """Состояние задачи: `queued` → `running` со счётчиком строк → `done` или
    `error` с причиной. Это то, что человек видит на странице данных."""
    state = task_get(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Задача не найдена или её состояние устарело")
    return state
