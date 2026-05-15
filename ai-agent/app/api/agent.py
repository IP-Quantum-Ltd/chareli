from fastapi import APIRouter, HTTPException

from app.config import get_settings
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
async def run_proposal(proposal_id: str, submit_review: bool = True, override: bool = False) -> ProposalRunResponse:
    """Manually trigger the full pipeline for a proposal and submit the AI review to the server.

    Pass override=true to force a re-run even if the proposal was already reviewed by the agent.
    """
    runtime = get_runtime()
    if not override:
        proposal = await runtime.arcade_client.get_proposal(proposal_id)
        settings = get_settings()
        proposed_data = proposal.get("proposedData") or {}
        if proposal.get("editorId") == settings.SERVICE_USER_ID and proposed_data.get("aiReview"):
            raise HTTPException(
                status_code=409,
                detail="Proposal was already reviewed by the AI agent. Pass override=true to force a re-run.",
            )
        existing_job = runtime.job_store.find_active_job("proposal_review", proposal_id)
    else:
        existing_job = None
    job = existing_job or runtime.job_store.create_job("proposal_review", proposal_id, submit_review=submit_review)
    if existing_job is None:
        await runtime.queue.enqueue(job.job_id)
    return ProposalRunResponse(
        accepted=True,
        job_id=job.job_id,
        status=job.status,
        proposal_id=proposal_id,
    )
