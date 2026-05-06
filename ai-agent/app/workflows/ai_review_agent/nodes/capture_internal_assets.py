import logging

from app.workflows.ai_review_agent.context import record_stage

logger = logging.getLogger(__name__)


class CaptureInternalAssetsNode:
    def __init__(self, capture_service):
        self.capture_service = capture_service

    async def __call__(self, state):
        if state.get("status") == "failed":
            return state
        logger.info("Node: Capture | Proposal: %s", state.get("proposal_id") or state.get("game_id"))
        try:
            proposal_id = str(state.get("proposal_id") or state.get("game_id") or "")
            game_id = str(state.get("game_id") or "")

            if not game_id:
                # CREATE proposal — no existing game to capture from; skip
                state["internal_imgs_urls"] = []
                state["status"] = "captured"
                record_stage(state, "capture", "skipped", "No existing game to capture (new game proposal).")
                return state

            if not proposal_id:
                raise ValueError("Capture node requires an initialized proposal_id.")

            capture_result = await self.capture_service.capture_stage0_internal_assets(
                game_id,
                proposal_id,
            )

            if not capture_result.image_urls:
                raise ValueError("Failed to capture any internal reference image.")

            state["internal_imgs_paths"] = capture_result.paths
            state["internal_capture_metadata"] = capture_result.metadata
            state["internal_imgs_urls"] = capture_result.image_urls
            state["status"] = "captured"
            record_stage(state, "capture", "completed", f"Captured {len(capture_result.paths)} internal reference images.")
        except Exception as exc:
            detail = str(exc).strip() or repr(exc)
            logger.error("Capture Integrity Failed: %s", detail)
            state["status"] = "failed"
            state["error_message"] = f"CRITICAL: Internal capture failed. Pipeline terminated. Detail: {detail}"
            record_stage(state, "capture", "failed", state["error_message"])
        return state
