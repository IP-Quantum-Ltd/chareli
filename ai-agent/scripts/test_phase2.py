import asyncio
import logging
from app.services.seo_service import SEOService
from app.services.librarian import LibrarianService

logging.basicConfig(level=logging.INFO)

async def test_intelligence():
    print("\n--- Testing Stage 1: SEO Intelligence ---")
    seo = SEOService()
    analysis = await seo.analyze_keyword("best shooting games 2024")
    print(f"Analysis Result: {analysis}")

    print("\n--- Testing Stage 2: The Librarian ---")
    lib = LibrarianService()
    facts = await lib.enrich_game_data("test-id", "Penalty Shoot")
    print(f"Enriched Facts: {facts}")

if __name__ == "__main__":
    asyncio.run(test_intelligence())
