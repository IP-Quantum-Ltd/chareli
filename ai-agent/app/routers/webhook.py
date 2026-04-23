import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from app.config import settings
from app.models.schemas import ProposalCreatedPayload
from app.services import task_queue as queue

logger = logging.getLogger(__name__)

router = APIRouter()


class ProposalCreatedResponse(BaseModel):
    accepted: bool
    proposalId: str


@router.post(
    "/webhook/proposal-created",
    status_code=202,
    tags=["Webhook"],
    summary="Queue a new proposal review job",
    description=(
        "Receives a proposal-created webhook from the main ArcadeBox app, validates the "
        "optional shared secret, and enqueues the proposal for asynchronous AI processing."
    ),
    response_model=ProposalCreatedResponse,
)
async def proposal_created(
    payload: ProposalCreatedPayload,
    x_webhook_secret: Optional[str] = Header(default=None),
):
    """
    Receives a webhook from the main ArcadeBox app when a new GameProposal is created.
    Validates the secret (if configured) and enqueues the proposal for AI processing.
    Returns 202 immediately — processing happens asynchronously.
    """
    if settings.WEBHOOK_SECRET and x_webhook_secret != settings.WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

    enqueued = await queue.enqueue(payload.proposalId)
    if not enqueued:
        logger.debug(f"[webhook] Proposal {payload.proposalId} already in queue")

    return {"accepted": True, "proposalId": payload.proposalId}
