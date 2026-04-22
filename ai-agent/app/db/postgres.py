from typing import Optional
from urllib.parse import quote_plus

import asyncpg

from app.config import settings

_pool: Optional[asyncpg.Pool] = None


def _build_dsn() -> str:
    if settings.DATABASE_URL:
        return settings.DATABASE_URL

    if all(
        [
            settings.DB_HOST,
            settings.DB_USERNAME,
            settings.DB_PASSWORD,
            settings.DB_DATABASE,
        ]
    ):
        return (
            f"postgresql://{quote_plus(settings.DB_USERNAME)}:{quote_plus(settings.DB_PASSWORD)}"
            f"@{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_DATABASE}"
        )

    return ""


async def get_postgres_pool() -> Optional[asyncpg.Pool]:
    global _pool

    if _pool is not None:
        return _pool

    dsn = _build_dsn()
    if not dsn:
        return None

    _pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=4)
    return _pool


async def close_postgres_pool() -> None:
    global _pool

    if _pool is not None:
        await _pool.close()
        _pool = None


async def get_game_record(game_id: str) -> Optional[dict]:
    pool = await get_postgres_pool()
    if pool is None or not game_id:
        return None

    async with pool.acquire() as conn:
        row = await conn.fetchrow('SELECT * FROM public."game" WHERE id = $1 LIMIT 1', game_id)
        return dict(row) if row else None
