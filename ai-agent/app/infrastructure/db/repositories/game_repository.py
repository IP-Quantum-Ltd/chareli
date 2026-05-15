import json
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

    async def get_next_pending_proposal(self) -> Optional[Dict[str, Any]]:
        """
        Atomically find and claim the next pending proposal for AI review.
        Uses SKIP LOCKED for safe concurrent processing across multiple instances.
        """
        pool = await self._provider.get_pool()
        if pool is None:
            return None
        async with pool.acquire() as conn:
            async with conn.transaction():
                # We target PENDING proposals that aren't already being worked on by an agent.
                # We check proposedData->'aiReview'->'pipeline_status' to avoid duplicate work.
                row = await conn.fetchrow(
                    """
                    SELECT id, "gameId", "proposedData"
                    FROM public.game_proposals
                    WHERE status = 'pending'
                      AND (
                        "proposedData"->'aiReview' IS NULL 
                        OR "proposedData"->'aiReview'->>'pipeline_status' NOT IN ('processing', 'completed')
                      )
                    ORDER BY "createdAt" ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                    """
                )
                if not row:
                    return None
                
                record = dict(row)
                proposed_data = record["proposedData"] or {}
                if "aiReview" not in proposed_data:
                    proposed_data["aiReview"] = {}
                
                # Mark as processing immediately within the transaction
                proposed_data["aiReview"]["pipeline_status"] = "processing"
                
                await conn.execute(
                    'UPDATE public.game_proposals SET "proposedData" = $1 WHERE id = $2',
                    json.dumps(proposed_data),
                    record["id"]
                )
                return record

    async def get_next_enrichment_candidate_game(self) -> Optional[Dict[str, Any]]:
        """
        Find a published game that lacks SEO metadata and has no active proposal.
        Allows the agent to proactively enrich the catalog.
        """
        pool = await self._provider.get_pool()
        if pool is None:
            return None
        async with pool.acquire() as conn:
            async with conn.transaction():
                # Candidates: games with no seoMeta AND no pending proposal.
                row = await conn.fetchrow(
                    """
                    SELECT g.id, g.title
                    FROM public.games g
                    LEFT JOIN public.game_proposals p ON p."gameId" = g.id AND p.status = 'pending'
                    WHERE g.status = 'active'
                      AND p.id IS NULL
                      AND (g."seoMeta" IS NULL OR g."seoMeta" = '{}'::jsonb)
                    ORDER BY g."createdAt" DESC
                    LIMIT 1
                    FOR UPDATE OF g SKIP LOCKED
                    """
                )
                return dict(row) if row else None

    async def update_proposal_ai_status(self, proposal_id: str, status: str, error: Optional[str] = None) -> None:
        """Update the AI processing status in the database."""
        pool = await self._provider.get_pool()
        if pool is None:
            return
        async with pool.acquire() as conn:
            row = await conn.fetchrow('SELECT "proposedData" FROM public.game_proposals WHERE id = $1', proposal_id)
            if not row:
                return
            proposed_data = row["proposedData"] or {}
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

    async def get_proposal_record(self, proposal_id: str) -> Optional[Dict[str, Any]]:
        """Fetch a full proposal record from the database."""
        pool = await self._provider.get_pool()
        if pool is None or not proposal_id:
            return None
        async with pool.acquire() as conn:
            row = await conn.fetchrow('SELECT * FROM public.game_proposals WHERE id = $1 LIMIT 1', proposal_id)
            if not row:
                return None
            record = dict(row)
            # asyncpg might return JSONB as a dict already, but let's be safe
            if isinstance(record.get("proposedData"), str):
                try:
                    record["proposedData"] = json.loads(record["proposedData"])
                except (json.JSONDecodeError, ValueError):
                    record["proposedData"] = {}
            return record
