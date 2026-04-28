import asyncio
import base64
import logging
from pathlib import Path

from app.workflows.ai_review_agent.context import record_stage

logger = logging.getLogger(__name__)


class CaptureInternalAssetsNode:
    def __init__(self, capture_service, artifact_store):
        self.capture_service = capture_service
        self.artifact_store = artifact_store

    async def __call__(self, state):
        if state.get("status") == "failed":
            return state
        logger.info("Node: Capture | Proposal: %s", state.get("proposal_id") or state.get("game_id"))
        try:
            proposal_id = str(state.get("proposal_id") or state.get("game_id") or "")
            game_id = str(state.get("game_id") or "")
            if not proposal_id or not game_id:
                raise ValueError("Capture node requires initialized proposal_id/game_id state.")
            capture_result = await self.capture_service.capture_stage0_internal_assets(
                game_id,
                str(self.artifact_store.proposal_dir(proposal_id)),
            )
            state["internal_imgs_paths"] = capture_result.paths
            state["internal_capture_metadata"] = capture_result.metadata
            if not capture_result.paths:
                raise ValueError("Failed to capture any internal reference image.")
            state["internal_imgs_base64"] = []
            for path in capture_result.paths:
                file_bytes = await asyncio.to_thread(Path(path).read_bytes)
                state["internal_imgs_base64"].append(base64.b64encode(file_bytes).decode("utf-8"))
            state["status"] = "captured"
            record_stage(state, "capture", "completed", f"Captured {len(capture_result.paths)} internal reference images.")
        except Exception as exc:
            detail = str(exc).strip() or repr(exc)
            logger.error("Capture Integrity Failed: %s", detail)
            state["status"] = "failed"
            state["error_message"] = f"CRITICAL: Internal capture failed. Pipeline terminated. Detail: {detail}"
            record_stage(state, "capture", "failed", state["error_message"])
        return state
