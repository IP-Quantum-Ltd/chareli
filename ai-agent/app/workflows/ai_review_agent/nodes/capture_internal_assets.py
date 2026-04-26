import base64
import logging

logger = logging.getLogger(__name__)


class CaptureInternalAssetsNode:
    def __init__(self, capture_service, artifact_store):
        self.capture_service = capture_service
        self.artifact_store = artifact_store

    async def __call__(self, state):
        logger.info("Node: Capture | Proposal: %s", state["proposal_id"])
        try:
            capture_result = await self.capture_service.capture_stage0_internal_assets(
                state["game_id"],
                str(self.artifact_store.proposal_dir(state["proposal_id"])),
            )
            state["internal_imgs_paths"] = capture_result.paths
            state["internal_capture_metadata"] = capture_result.metadata
            if not capture_result.paths or len(capture_result.paths) < 2:
                raise ValueError("Failed to capture both internal reference images.")
            state["internal_imgs_base64"] = []
            for path in capture_result.paths:
                with open(path, "rb") as handle:
                    state["internal_imgs_base64"].append(base64.b64encode(handle.read()).decode("utf-8"))
            state["status"] = "captured"
        except Exception as exc:
            logger.error("Capture Integrity Failed: %s", exc)
            state["status"] = "failed"
            state["error_message"] = f"CRITICAL: Internal capture failed. Pipeline terminated. Detail: {exc}"
        return state
