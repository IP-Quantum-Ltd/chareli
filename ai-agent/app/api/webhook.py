import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.domain.schemas import ProposalCreatedPayload
from app.runtime import get_runtime

logger = logging.getLogger(__name__)

router = APIRouter()


class ProposalCreatedResponse(BaseModel):
    accepted: bool
    proposalId: str


@router.post("/webhook/proposal-created", status_code=202, tags=["Webhook"], response_model=ProposalCreatedResponse)
async def proposal_created(payload: ProposalCreatedPayload, x_webhook_secret: Optional[str] = Header(default=None)):
    runtime = get_runtime()
    if runtime.config.arcade_api.webhook_secret and x_webhook_secret != runtime.config.arcade_api.webhook_secret:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")
    existing_job = runtime.job_store.find_active_job("proposal_review", payload.proposalId)
    if existing_job is None:
        job = runtime.job_store.create_job("proposal_review", payload.proposalId, submit_review=True)
        enqueued = await runtime.queue.enqueue(job.job_id)
    else:
        enqueued = False
    if not enqueued:
        logger.debug("[webhook] Proposal %s already in queue", payload.proposalId)
    return {"accepted": True, "proposalId": payload.proposalId}
