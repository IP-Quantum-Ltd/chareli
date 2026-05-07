import logging

from app.workflows.ai_review_agent.context import ensure_state_defaults, record_stage

logger = logging.getLogger(__name__)


class InitializeAgentNode:
    def __init__(self, arcade_client, game_repository, proposal_context_builder):
        self.arcade_client = arcade_client
        self.game_repository = game_repository
        self.proposal_context_builder = proposal_context_builder

    async def __call__(self, state):
        ensure_state_defaults(state)
        proposal_id = (state.get("proposal_id") or "").strip()
        game_id = (state.get("game_id") or "").strip()
        submit_review = bool(state.get("submit_review", False))

        try:
            if proposal_id:
                logger.info("Node: Initialize | Proposal: %s", proposal_id)
                proposal = await self.arcade_client.get_proposal(proposal_id)
                proposal_type = str(proposal.get("type") or "update").lower()
                derived_game_id = self.proposal_context_builder.extract_game_id(proposal)

                # If the agent already enriched this proposal, don't submit again
                if proposal.get("proposedData", {}).get("aiReview"):
                    submit_review = False

                if proposal_type == "create" and not derived_game_id:
                    # New game — no existing game record to look up; research from title only
                    game_title = self.proposal_context_builder.extract_game_title(proposal, proposal_id)
                    if not game_title or game_title.startswith("Game Proposal"):
                        raise ValueError(f"CREATE proposal {proposal_id} has no game title in proposedData.")
                    logger.info("Node: Initialize | CREATE proposal | Title: %s", game_title)
                    state["proposal_id"] = proposal_id
                    state["game_id"] = ""
                    state["game_title"] = game_title
                    state["proposal_type"] = "create"
                    state["proposal_snapshot"] = proposal
                    state["submit_review"] = submit_review
                else:
                    if not derived_game_id:
                        raise ValueError(
                            f"Proposal {proposal_id} does not include a game id, so the canonical game table cannot be queried."
                        )
                    game_record = await self.game_repository.get_game_record(derived_game_id)
                    if not game_record:
                        raise ValueError(f"Game {derived_game_id} was not found in the Postgres game table.")
                    proposal_with_game = self.proposal_context_builder.merge_game_record_into_proposal(proposal, game_record)
                    game_title = self.proposal_context_builder.extract_game_title(proposal_with_game, proposal_id)
                    state["proposal_id"] = proposal_id
                    state["game_id"] = derived_game_id
                    state["game_title"] = game_title
                    state["proposal_type"] = proposal_type
                    state["proposal_snapshot"] = proposal_with_game
                    state["submit_review"] = submit_review
            else:
                if not game_id:
                    raise ValueError("The agent requires a game_id when no proposal_id is provided.")
                logger.info("Node: Initialize | Game: %s", game_id)
                game_record = await self.game_repository.get_game_record(game_id)
                if not game_record:
                    raise ValueError(f"Game {game_id} was not found in the Postgres game table.")
                game_title = self.proposal_context_builder.extract_game_title({"game": game_record, "gameId": game_id}, game_id)
                state["proposal_id"] = game_id
                state["game_id"] = game_id
                state["game_title"] = game_title
                state["proposal_snapshot"] = {"game": game_record, "gameId": game_id, "proposedData": {"title": game_title}}
                state["submit_review"] = submit_review
            state["status"] = "initialized"
            state["error_message"] = ""
            record_stage(state, "initialize", "completed", f"Initialized context for {state['game_title']}")
        except Exception as exc:
            logger.error("Initialization Failed: %s", exc)
            state["status"] = "failed"
            state["error_message"] = f"CRITICAL: Agent initialization failed. Detail: {exc}"
            record_stage(state, "initialize", "failed", state["error_message"])
        return state
