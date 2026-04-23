from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import get_session

router = APIRouter()


@router.get("/health")
async def health(session: AsyncSession = Depends(get_session)):
    db_status = "ok"
    try:
        await session.exec(text("SELECT 1"))
    except Exception:
        db_status = "error"

    return {
        "status": "ok",
        "database": db_status
    }
