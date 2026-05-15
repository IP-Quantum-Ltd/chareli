import datetime
import json
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class GameRepository:
    def __init__(self, provider):
        self._provider = provider

    async def get_next_pending_proposal(self, min_created_at: Optional[datetime.datetime] = None) -> Optional[Dict[str, Any]]:
        """
        Find the next pending proposal and mark it as 'processing'.
        Atomic operation using SKIP LOCKED.
        """
        pool = await self._provider.get_pool()
        if pool is None:
            return None
        
        # Normalize min_created_at for Postgres
        normalized_start = None
        if min_created_at:
            if min_created_at.tzinfo:
                normalized_start = min_created_at.astimezone(datetime.timezone.utc).replace(tzinfo=None)
            else:
                normalized_start = min_created_at

        async with pool.acquire() as conn:
            async with conn.transaction():
                # We target PENDING proposals that:
                # 1. Haven't been started (aiReview is NULL)
                # 2. Failed or were aborted
                # 3. Are stuck in 'processing' (watchdog)
                # CRITICAL: Watchdog only reclaims things created AFTER process start (normalized_start)
                
                time_filter = ""
                args = []
                if normalized_start:
                    time_filter = 'AND "createdAt" >= $1'
                    args.append(normalized_start)

                query = f"""
                    SELECT id, "gameId", "proposedData"
                    FROM public.game_proposals
                    WHERE status = 'pending'
                      {time_filter}
                      AND (
                        "proposedData"->'aiReview' IS NULL 
                        OR "proposedData"->'aiReview'->>'pipeline_status' NOT IN ('processing', 'completed')
                        OR (
                            "proposedData"->'aiReview'->>'pipeline_status' = 'processing'
                            AND (
                                (("proposedData"->'aiReview'->>'processing_started_at')::timestamp AT TIME ZONE 'UTC') < (NOW() AT TIME ZONE 'UTC' - INTERVAL '30 minutes')
                                OR "proposedData"->'aiReview'->>'processing_started_at' IS NULL
                            )
                        )
                      )
                    ORDER BY "createdAt" ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                """
                row = await conn.fetchrow(query, *args)
                if not row:
                    return None
                
                record = dict(row)
                proposed_data = record["proposedData"] or {}
                if isinstance(proposed_data, str):
                    try:
                        proposed_data = json.loads(proposed_data)
                    except (json.JSONDecodeError, ValueError):
                        proposed_data = {}
                
                if not isinstance(proposed_data, dict):
                    proposed_data = {}
                
                if "aiReview" not in proposed_data:
                    proposed_data["aiReview"] = {}
                
                # Mark as processing immediately within the transaction
                proposed_data["aiReview"]["pipeline_status"] = "processing"
                proposed_data["aiReview"]["processing_started_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                
                await conn.execute(
                    'UPDATE public.game_proposals SET "proposedData" = $1, "updatedAt" = NOW() WHERE id = $2',
                    json.dumps(proposed_data),
                    record["id"]
                )
                
                return record

    async def get_next_enrichment_candidate_game(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """
        Find a published game that needs an agent review AND atomically claim it
        by creating a pending proposal for it.
        
        This prevents infinite loops in cron_scan and ensures only one agent 
        works on a game at a time.
        """
        pool = await self._provider.get_pool()
        if pool is None:
            return None
        async with pool.acquire() as conn:
            async with conn.transaction():
                # 1. Find the candidate game
                row = await conn.fetchrow(
                    """
                    SELECT g.id, g.title
                    FROM public.games g
                    WHERE g.status = 'active'
                      AND NOT EXISTS (
                          SELECT 1 FROM public.game_proposals p 
                          WHERE p."gameId" = g.id AND p.status = 'pending'
                      )
                      AND NOT EXISTS (
                          SELECT 1 FROM public.game_proposals p 
                          WHERE p."gameId" = g.id 
                            AND p.status = 'approved' 
                            AND p."editorId" = $1
                      )
                    ORDER BY g."createdAt" ASC
                    LIMIT 1
                    FOR UPDATE OF g SKIP LOCKED
                    """,
                    agent_id
                )
                if not row:
                    return None
                
                game_id = row["id"]
                
                # 2. Atomically "claim" it by creating a pending proposal
                # This ensures subsequent loops (or other agents) won't see this game.
                initial_proposed_data = {
                    "aiReview": {
                        "pipeline_status": "processing",
                        "processing_started_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
                    }
                }
                
                proposal_row = await conn.fetchrow(
                    """
                    INSERT INTO public.game_proposals (
                        "gameId", "editorId", "status", "type", "proposedData", "createdAt", "updatedAt"
                    ) VALUES ($1, $2, 'pending', 'update', $3, NOW(), NOW())
                    RETURNING id
                    """,
                    game_id, agent_id, json.dumps(initial_proposed_data)
                )
                
                return {
                    "id": proposal_row["id"],
                    "gameId": game_id,
                    "title": row["title"]
                }

    async def update_proposal_ai_status(self, proposal_id: str, status: str, error: Optional[str] = None) -> None:
        """Update the AI processing status in the database."""
        pool = await self._provider.get_pool()
        if pool is None:
            return
            
        async with pool.acquire() as conn:
            try:
                # 1. Get current data
                row = await conn.fetchrow('SELECT "proposedData" FROM public.game_proposals WHERE id = $1', proposal_id)
                if not row:
                    return
                
                proposed_data = row["proposedData"] or {}
                if isinstance(proposed_data, str):
                    proposed_data = json.loads(proposed_data)
                
                if "aiReview" not in proposed_data:
                    proposed_data["aiReview"] = {}
                
                # 2. Update status
                proposed_data["aiReview"]["pipeline_status"] = status
                if error:
                    proposed_data["aiReview"]["error_message"] = error
                
                if status == "completed":
                    proposed_data["aiReview"]["completed_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                
                # 3. Write back
                await conn.execute(
                    'UPDATE public.game_proposals SET "proposedData" = $1, "updatedAt" = NOW() WHERE id = $2',
                    json.dumps(proposed_data),
                    proposal_id
                )
            except Exception as exc:
                logger.error(f"[repo] Failed to update proposal status for {proposal_id}: {exc}")

    async def get_proposal_record(self, proposal_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch a proposal record with joined game, thumbnail, and editor metadata.
        Replicates the structure previously served by the Arcade API.
        """
        pool = await self._provider.get_pool()
        if pool is None:
            return None
        async with pool.acquire() as conn:
            # Join with games, files, and users to reconstruct the expected Arcade API payload
            row = await conn.fetchrow(
                """
                SELECT 
                    p.id, p."gameId", p.status, p.type, p."proposedData",
                    p."createdAt", p."updatedAt",
                    g.title as "game_title",
                    g.description as "game_description",
                    g.metadata as "game_metadata",
                    g.status as "game_status",
                    f.id as "thumbnail_file_id",
                    f."s3Key" as "thumbnail_s3Key",
                    f.variants as "thumbnail_variants",
                    u.email as "editor_email",
                    u.role as "editor_role"
                FROM public.game_proposals p
                JOIN public.games g ON p."gameId" = g.id
                LEFT JOIN public.files f ON g."thumbnailFileId" = f.id
                LEFT JOIN public.users u ON p."editorId" = u.id
                WHERE p.id = $1
                """,
                proposal_id
            )
            if not row:
                return None
            
            record = dict(row)
            
            # Unpack JSONB
            proposed_data = record["proposedData"] or {}
            if isinstance(proposed_data, str):
                try:
                    proposed_data = json.loads(proposed_data)
                except:
                    proposed_data = {}

            # Construct the complex object the AI workflow expects
            return {
                "id": record["id"],
                "gameId": record["gameId"],
                "status": record["status"],
                "type": record["type"],
                "proposedData": proposed_data,
                "createdAt": record["createdAt"].isoformat() if record["createdAt"] else None,
                "updatedAt": record["updatedAt"].isoformat() if record["updatedAt"] else None,
                "game": {
                    "id": record["gameId"],
                    "title": record["game_title"],
                    "description": record["game_description"],
                    "metadata": record["game_metadata"],
                    "status": record["game_status"],
                    "thumbnailFile": {
                        "id": record["thumbnail_file_id"],
                        "s3Key": record["thumbnail_s3Key"],
                        "variants": record["thumbnail_variants"]
                    } if record["thumbnail_file_id"] else None
                },
                "editor": {
                    "email": record["editor_email"],
                    "role": record["editor_role"]
                } if record["editor_email"] else None
            }
