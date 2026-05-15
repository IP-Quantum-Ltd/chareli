import asyncio
import os
import logging
from dotenv import load_dotenv

# Set up logging to see what the cron scan is doing
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")

from app.main import cron_scan
from app.runtime import init_runtime, shutdown_runtime

async def test_cron():
    load_dotenv()
    print("Initializing runtime...")
    init_runtime()
    
    print("\nStarting cron_scan...")
    await cron_scan()
    
    print("\nShutting down runtime...")
    await shutdown_runtime()

if __name__ == "__main__":
    asyncio.run(test_cron())
