from uuid import uuid4
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel, create_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings

# engine = create_engine(settings.DATABASE_URL, echo=True)
async_engine = create_async_engine(
    settings.DATABASE_URL, 
    echo=True, 
    future=True,
    connect_args={
        "prepared_statement_cache_size": 0,
        "statement_cache_size": 0,
        "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4().hex}__",
    }
)


async def init_db():
    # In a real scenario we might not want to create_all if migrations are handled elsewhere
    # but for setup verification:
    # async with async_engine.begin() as conn:
    #    await conn.run_sync(SQLModel.metadata.create_all)
    pass


async def get_session() -> AsyncSession:
    async_session = sessionmaker(
        async_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with async_session() as session:
        yield session
