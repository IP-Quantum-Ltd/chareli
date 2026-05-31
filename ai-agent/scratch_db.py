import asyncio
import os
import json
from dotenv import load_dotenv
import asyncpg

async def main():
    load_dotenv()
    host = os.getenv("DB_HOST")
    port = int(os.getenv("DB_PORT", 5432))
    username = os.getenv("DB_USERNAME")
    password = os.getenv("DB_PASSWORD")
    database = os.getenv("DB_DATABASE")
    
    dsn = f"postgresql://{username}:{password}@{host}:{port}/{database}"
    
    conn = await asyncpg.connect(dsn=dsn, statement_cache_size=0)
    try:
        row = await conn.fetchrow("""
            SELECT id, title, description, metadata, "createdAt"
            FROM public.games
            WHERE id = '00ee7ecf-c39f-418a-8da4-e82890bde53f'
        """)
        
        if row:
            print("=== EXISTING GAME RECORD ===")
            print(f"Title: {row['title']}")
            print(f"Description Length: {len(row['description'] or '')}")
            print(f"Description Snippet: {repr((row['description'] or '')[:300])}")
            meta = json.loads(row["metadata"]) if isinstance(row["metadata"], str) else row["metadata"]
            print(f"HowToPlay Length: {len(meta.get('howToPlay', '') or '')}")
        else:
            print("No game record found for 00ee7ecf-c39f-418a-8da4-e82890bde53f")
            
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
