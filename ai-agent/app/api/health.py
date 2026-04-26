from fastapi import APIRouter

from app.domain.schemas import HealthResponse

router = APIRouter()


@router.get("/health", tags=["Health"], response_model=HealthResponse)
async def health():
    return {"status": "ok"}


@router.get("/health/live", tags=["Health"], response_model=HealthResponse)
async def health_live():
    return {"status": "ok"}
