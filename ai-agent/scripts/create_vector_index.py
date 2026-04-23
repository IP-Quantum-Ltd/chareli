import asyncio
import logging
from app.db.mongo import get_mongodb

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vector_index_setup")

async def create_vector_search_index():
    """
    Programmatically creates the Atlas Vector Search index on game_knowledge_chunks.
    Note: This requires an Atlas M0 or higher cluster.
    """
    logger.info("Connecting to MongoDB...")
    db = await get_mongodb()
    collection = db["game_knowledge_chunks"]

    # The index definition using the Cosine Rule
    index_definition = {
        "name": "vector_index",
        "type": "vectorSearch",
        "definition": {
            "fields": [
                {
                    "type": "vector",
                    "numDimensions": 3072,
                    "path": "embedding",
                    "similarity": "cosine"
                }
            ]
        }
    }

    try:
        logger.info("Requesting creation of Vector Search index 'vector_index'...")
        # Note: create_search_index is available in modern motor/pymongo versions
        result = await collection.create_search_index(model=index_definition)
        logger.info(f"✅ Index creation request successful! Name: {result}")
        logger.info("It may take a few minutes for the status to become 'ACTIVE' in Atlas.")
        
    except Exception as e:
        logger.error(f"❌ Failed to create index: {e}")
        logger.info("If this failed, you can still create it manually in the Atlas UI using the JSON provided in my previous message.")

if __name__ == "__main__":
    asyncio.run(create_vector_search_index())
