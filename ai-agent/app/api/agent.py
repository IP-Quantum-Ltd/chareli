from fastapi import APIRouter

from app.domain.schemas import AgentRunRequest, AgentRunResponse, ProposalRunResponse
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


@router.post("/proposal/{proposal_id}", tags=["Agent"], response_model=ProposalRunResponse, status_code=202)
async def run_proposal(proposal_id: str, submit_review: bool = True) -> ProposalRunResponse:
    """Manually trigger the full pipeline for a proposal and submit the AI review to the server."""
    runtime = get_runtime()
    existing_job = runtime.job_store.find_active_job("proposal_review", proposal_id)
    job = existing_job or runtime.job_store.create_job("proposal_review", proposal_id, submit_review=submit_review)
    if existing_job is None:
        await runtime.queue.enqueue(job.job_id)
    return ProposalRunResponse(
        accepted=True,
        job_id=job.job_id,
        status=job.status,
        proposal_id=proposal_id,
    )
