import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

async def test_mongo():
    uri = os.getenv("MONGODB_URL")
    db_name = os.getenv("MONGODB_DB_NAME", "chareli_ai")
    print(f"Connecting to MongoDB: {uri[:30]}...")
    client = AsyncIOMotorClient(uri)
    try:
        # The ismaster command is cheap and does not require auth.
        await client.admin.command('ismaster')
        print("MongoDB connection successful!")
        db = client[db_name]
        collections = await db.list_collection_names()
        print(f"Collections in {db_name}: {collections}")
    except Exception as e:
        print(f"MongoDB connection failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    asyncio.run(test_mongo())
