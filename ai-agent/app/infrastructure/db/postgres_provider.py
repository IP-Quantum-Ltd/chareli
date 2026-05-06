from typing import TYPE_CHECKING, Optional
from urllib.parse import quote_plus

from app.config import PostgresConfig

if TYPE_CHECKING:
    import asyncpg


class PostgresProvider:
    def __init__(self, config: PostgresConfig):
        self._config = config
        self._pool: Optional["asyncpg.Pool"] = None

    def build_dsn(self) -> str:
        if self._config.database_url:
            return self._config.database_url
        if all([self._config.host, self._config.username, self._config.password, self._config.database]):
            return (
                f"postgresql://{quote_plus(self._config.username)}:{quote_plus(self._config.password)}"
                f"@{self._config.host}:{self._config.port}/{self._config.database}"
            )
        return ""

    async def get_pool(self) -> Optional["asyncpg.Pool"]:
        if self._pool is not None:
            return self._pool
        dsn = self.build_dsn()
        if not dsn:
            return None
        import asyncpg

        self._pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=4, statement_cache_size=0, timeout=20)
        return self._pool

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
