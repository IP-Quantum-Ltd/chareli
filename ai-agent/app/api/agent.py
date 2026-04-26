from fastapi import APIRouter

from app.domain.schemas import AgentRunRequest, AgentRunResponse
from app.runtime import get_runtime

router = APIRouter(prefix="/agent")


@router.post("/run", tags=["Agent"], response_model=AgentRunResponse, status_code=202)
async def run_agent(payload: AgentRunRequest) -> AgentRunResponse:
    runtime = get_runtime()
    existing_job = runtime.job_store.find_active_job("game_review", payload.game_id)
    job = existing_job or runtime.job_store.create_job("game_review", payload.game_id, submit_review=payload.submit_review)
    if existing_job is None:
        await runtime.queue.enqueue(job.job_id)
    return AgentRunResponse(
        accepted=True,
        job_id=job.job_id,
        status=job.status,
        game_id=payload.game_id,
    )
