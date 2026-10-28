"""Строки загруженных наборов.

Наборы-схемы строк не хранят вовсе: в базе лежит описание колонок и `seed`, а
строки порождает клиент тем же генератором. Это экономит хранилище и трафик и
сохраняет свойство «цифры одинаковы у всех». Здесь — только настоящие данные,
которые человек принёс файлом.
"""
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.access import can_edit, can_view, why_read_only
from app.auth import current_user
from app.core import MAX_UPLOAD_ROWS, Dataset, UploadRow, User, now
from app.db import get_db

router = APIRouter(prefix="/api/datasets", tags=["rows"])


def _dataset(db: Session, ds_id: str) -> Dataset:
    ds = db.get(Dataset, ds_id)
    if ds is None:
        raise HTTPException(status_code=404, detail="Набор не найден")
    return ds


@router.get("/{ds_id}/rows")
def read_rows(ds_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ds = _dataset(db, ds_id)
    if not can_view(user, ds):
        raise HTTPException(status_code=403, detail="Нет доступа к набору")
    rows = db.execute(
        select(UploadRow.data).where(UploadRow.dataset_id == ds_id).order_by(UploadRow.idx)
    ).scalars().all()
    return {"rows": rows, "count": len(rows)}


@router.put("/{ds_id}/rows")
def write_rows(ds_id: str, rows: list = Body(..., embed=True), db: Session = Depends(get_db),
               user: User = Depends(current_user)):
    """Строки приходят целиком и заменяют прежние: набор — это файл, а не журнал
    правок. Половина старых строк рядом с новыми была бы молчаливой ложью."""
    ds = _dataset(db, ds_id)
    if not can_edit(user, ds):
        raise HTTPException(status_code=403, detail=why_read_only(ds))
    if len(rows) > MAX_UPLOAD_ROWS:
        raise HTTPException(status_code=413, detail=f"Слишком много строк: предел — {MAX_UPLOAD_ROWS}")
    db.execute(delete(UploadRow).where(UploadRow.dataset_id == ds_id))
    db.bulk_save_objects([UploadRow(dataset_id=ds_id, idx=i, data=r) for i, r in enumerate(rows)])
    ds.updated_at = now()
    ds.updated_by = user.username
    db.commit()
    return {"count": len(rows)}


@router.delete("/{ds_id}/rows", status_code=204)
def drop_rows(ds_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ds = db.get(Dataset, ds_id)
    # Набор могли уже удалить — строки всё равно подчищаем
    if ds is not None and not can_edit(user, ds):
        raise HTTPException(status_code=403, detail=why_read_only(ds))
    db.execute(delete(UploadRow).where(UploadRow.dataset_id == ds_id))
    db.commit()
