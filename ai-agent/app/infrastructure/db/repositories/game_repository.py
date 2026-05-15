import json
import datetime
from typing import Any, Dict, List, Optional

from app.infrastructure.db.postgres_provider import PostgresProvider


class GameRepository:
    def __init__(self, provider: PostgresProvider):
        self._provider = provider

    async def get_game_record(self, game_id: str) -> Optional[Dict[str, Any]]:
        pool = await self._provider.get_pool()
        if pool is None or not game_id:
            return None
        async with pool.acquire() as conn:
            try:
                row = await conn.fetchrow('SELECT * FROM public."game" WHERE id = $1 LIMIT 1', game_id)
            except Exception as exc:
                if 'relation "public.game" does not exist' not in str(exc):
                    raise
                row = await conn.fetchrow('SELECT * FROM public.games WHERE id = $1 LIMIT 1', game_id)
            if not row:
                return None
            record = dict(row)
            for field in ("metadata", "seoMeta", "config"):
                val = record.get(field)
                if isinstance(val, str):
                    try:
                        record[field] = json.loads(val)
                    except (json.JSONDecodeError, ValueError):
                        record[field] = {}
            return record

    async def get_public_game_by_offset(self, offset: int = 0) -> Optional[Dict[str, Any]]:
        pool = await self._provider.get_pool()
        if pool is None:
            return None
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT id, title
                FROM public.games
                ORDER BY title ASC, id ASC
                OFFSET $1
                LIMIT 1
                """,
                max(offset, 0),
            )
            return dict(row) if row else None

    async def get_public_game_with_thumbnail_by_offset(self, offset: int = 0) -> Optional[Dict[str, Any]]:
        return await self._fetch_public_game_with_thumbnail(offset=offset)

    async def get_public_game_with_thumbnail_by_id(self, game_id: str) -> Optional[Dict[str, Any]]:
        return await self._fetch_public_game_with_thumbnail(game_id=game_id)

    async def _fetch_public_game_with_thumbnail(self, game_id: str = "", offset: int = 0) -> Optional[Dict[str, Any]]:
        pool = await self._provider.get_pool()
        if pool is None or (not game_id and offset < 0):
            return None
        where_clause = "WHERE g.id = $1" if game_id else ""
        value = game_id if game_id else max(offset, 0)
        query = f"""
            SELECT
                g.id,
                g.title,
                g."thumbnailFileId",
                f."s3Key",
                f.variants,
                gf."s3Key" as "gameFileS3Key"
            FROM public.games g
            LEFT JOIN public.files f ON f.id = g."thumbnailFileId"
            LEFT JOIN public.files gf ON gf.id = g."gameFileId"
            {where_clause}
            ORDER BY g.title ASC, g.id ASC
            {"LIMIT 1" if game_id else "OFFSET $1 LIMIT 1"}
        """
        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, value)
            if not row:
                return None
            record = dict(row)
            variants = record.get("variants")
            if isinstance(variants, str):
                try:
                    record["variants"] = json.loads(variants)
                except json.JSONDecodeError:
                    record["variants"] = {}
            elif variants is None:
                record["variants"] = {}
            return record

    async def fetch_rows(self, query: str, *args: Any) -> List[Dict[str, Any]]:
        pool = await self._provider.get_pool()
        if pool is None:
            return []
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, *args)
            return [dict(row) for row in rows]

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
            return None
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow('SELECT "proposedData" FROM public.game_proposals WHERE id = $1', proposal_id)
                if not row:
                    return
                proposed_data = row["proposedData"] or {}
                if isinstance(proposed_data, str):
                    try:
                        proposed_data = json.loads(proposed_data)
                    except (json.JSONDecodeError, ValueError):
                        proposed_data = {}
                
                if not isinstance(proposed_data, dict):
                    proposed_data = {}
                    
                if "aiReview" not in proposed_data:
                    proposed_data["aiReview"] = {}
                
                proposed_data["aiReview"]["pipeline_status"] = status
                if error:
                    proposed_data["aiReview"]["error"] = error
                
                await conn.execute(
                    'UPDATE public.game_proposals SET "proposedData" = $1 WHERE id = $2',
                    json.dumps(proposed_data),
                    proposal_id
                )
        except Exception as exc:
            logger.error(f"Failed to update AI status for proposal {proposal_id}: {exc}")

    async def get_proposal_record(self, proposal_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch a full proposal record including joined game and thumbnail metadata.
        This mimics the Arcade API's /api/game-proposals/:id response contract.
        """
        pool = await self._provider.get_pool()
        if pool is None or not proposal_id:
            return None
        query = """
            SELECT 
                p.*,
                g.id as "game_id",
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
            
                    }

            # Handle JSON parsing for the fields that might be strings
            containers = [record]
            if record.get("game"):
                containers.append(record["game"])
                
            for container in containers:
                for field in ("proposedData", "metadata", "seoMeta", "variants"):
                    if field in container:
                        val = container[field]
                        if isinstance(val, str):
                            try:
                                container[field] = json.loads(val)
                            except (json.JSONDecodeError, ValueError):
                                container[field] = {}
            return record
