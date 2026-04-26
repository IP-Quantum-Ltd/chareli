from typing import Any, Dict

from app.domain.dto import ProposalContext


class ProposalContextBuilder:
    def extract_game_id(self, proposal: Dict[str, Any]) -> str:
        game = proposal.get("game") or {}
        for value in (proposal.get("gameId"), game.get("id"), game.get("gameId")):
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    def merge_game_record_into_proposal(self, proposal: Dict[str, Any], game_record: Dict[str, Any]) -> Dict[str, Any]:
        merged = dict(proposal)
        merged_game = dict(game_record)
        proposal_game = proposal.get("game") or {}
        if isinstance(proposal_game, dict):
            merged_game.update({key: value for key, value in proposal_game.items() if value not in (None, "", [], {})})
        merged["game"] = merged_game
        if merged.get("gameId") in (None, "") and game_record.get("id"):
            merged["gameId"] = game_record["id"]
        return merged

    def extract_game_title(self, proposal: Dict[str, Any], proposal_id: str) -> str:
        proposed_data = proposal.get("proposedData") or {}
        game = proposal.get("game") or {}
        for value in (
            proposed_data.get("title"),
            proposed_data.get("name"),
            proposed_data.get("gameTitle"),
            proposal.get("title"),
            proposal.get("name"),
            game.get("title"),
            game.get("name"),
        ):
            if isinstance(value, str) and value.strip():
                return value.strip()
        return f"Game Proposal {proposal_id}"

    def build(self, proposal_id: str, game_id: str, game_title: str, proposal_snapshot: Dict[str, Any]) -> ProposalContext:
        return ProposalContext(
            proposal_id=proposal_id,
            game_id=game_id,
            game_title=game_title,
            proposal_snapshot=proposal_snapshot,
        )
