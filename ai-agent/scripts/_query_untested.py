import asyncio
import sys

sys.path.insert(0, ".")
from dotenv import load_dotenv

load_dotenv()


async def main():
    from app.infrastructure.db.postgres_provider import PostgresProvider
    from app.config.factories import get_runtime_config

    config = get_runtime_config()
    provider = PostgresProvider(config.postgres)
    pool = await provider.get_pool()
    if pool is None:
        print("Could not connect to database.")
        return

    print("Connected to DB")
    async with pool.acquire() as conn:
        total = await conn.fetchval('SELECT COUNT(*) FROM public.games')
        print(f"Total games in DB: {total}")
        rows = await conn.fetch(
            """
            SELECT g.id, g.title
            FROM public.games g
            WHERE g.id NOT IN (
                '00ee7ecf-c39f-418a-8da4-e82890bde53f',
                '04608138-3014-4ac4-997d-712fa9281a7d',
                '04d914d4-a271-439b-a533-7c017ca01e62',
                '050403c9-8fc3-4426-9399-f2601084e4e2',
                '11e4d255-fb1d-432a-8e1f-b23e59c284a7',
                'd1fbe524-b5e6-434c-91c4-bd3e7032fc72',
                '1272a842-61f6-410b-8c76-953408648c41'
            )
            ORDER BY RANDOM()
            LIMIT 5
            """
        )
    await provider.close()
    print(f"Untested games found: {len(rows)}")
    for r in rows:
        print(r["id"], "|", r["title"])


asyncio.run(main())
