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
            return dict(row) if row else None

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
                f.variants
            FROM public.games g
            LEFT JOIN public.files f ON f.id = g."thumbnailFileId"
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
