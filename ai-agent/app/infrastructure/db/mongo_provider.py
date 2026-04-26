from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import MongoConfig


class MongoProvider:
    def __init__(self, config: MongoConfig):
        self._config = config
        self._client: Optional[AsyncIOMotorClient] = None
        self._db: Optional[AsyncIOMotorDatabase] = None

    async def get_database(self) -> Optional[AsyncIOMotorDatabase]:
        if self._db is not None:
            return self._db
        if not self._config.url:
            return None
        self._client = AsyncIOMotorClient(self._config.url)
        self._db = self._client[self._config.database_name]
        return self._db

    async def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
            self._db = None
