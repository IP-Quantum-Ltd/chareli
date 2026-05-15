import asyncio
import os
import json
from dotenv import load_dotenv
from app.infrastructure.db.postgres_provider import PostgresProvider
from app.config.runtime_config import PostgresConfig

async def check_db():
    load_dotenv()
    config = PostgresConfig(
        database_url=os.getenv("DATABASE_URL") or "",
        host=os.getenv("DB_HOST") or "",
        port=int(os.getenv("DB_PORT", 5432)),
        username=os.getenv("DB_USERNAME") or "",
        password=os.getenv("DB_PASSWORD") or "",
        database=os.getenv("DB_DATABASE") or "",
    )
    provider = PostgresProvider(config)
    pool = await provider.get_pool()
    if not pool:
        print("Failed to connect to DB - check .env file")
        return

    async with pool.acquire() as conn:
        print("--- DB Status ---")
        # Check pending proposals
        pending_count = await conn.fetchval('SELECT COUNT(*) FROM public.game_proposals WHERE status = $1', 'pending')
        print(f"Pending proposals: {pending_count}")

        # Check games needing enrichment
        enrichment_count = await conn.fetchval(
            """
            SELECT COUNT(*)
            FROM public.games g
            LEFT JOIN public.game_proposals p ON p."gameId" = g.id AND p.status = 'pending'
            WHERE g.status = 'active'
              AND p.id IS NULL
              AND (g."seoMeta" IS NULL OR g."seoMeta" = '{}'::jsonb)
            """
        )
        print(f"Games needing enrichment: {enrichment_count}")

        if pending_count > 0:
            sample = await conn.fetchrow('SELECT id, "proposedData" FROM public.game_proposals WHERE status = $1 LIMIT 1', 'pending')
            print(f"\nSample pending proposal: {sample['id']}")
            proposed_data = sample['proposedData']
            if isinstance(proposed_data, str):
                proposed_data = json.loads(proposed_data)
            
            ai_status = proposed_data.get('aiReview', {}).get('pipeline_status', 'None')
            print(f"AI Review Status: {ai_status}")

    await provider.close()

if __name__ == "__main__":
    asyncio.run(check_db())
