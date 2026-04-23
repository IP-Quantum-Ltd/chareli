from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class HealthResponse(BaseModel):
    status: str


@router.get(
    "/health",
    tags=["Health"],
    summary="Health check",
    description="Returns a simple service health payload for liveness/readiness checks.",
    response_model=HealthResponse,
)
async def health():
    return {"status": "ok"}
