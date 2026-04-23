import asyncio
import logging
import sys
import os
import json

# Add the project root to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.analyst_agent import AnalystAgent

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger("test_analyst")

async def run_analyst_test():
    keyword = "Best retro arcade boxing games"
    logger.info(f"Testing Analyst Agent Stage 1 with keyword: '{keyword}'")
    
    agent = AnalystAgent()
    
    try:
        # NOTE: This will trigger a real Tavily Search and real LLM call (if key isn't sk-dummy)
        result = await agent.analyze_keyword(keyword)
        
        print("\n--- Analyst Agent Stage 1 Result ---")
        print(json.dumps(result, indent=2))
        print("\n✅ Analyst Agent Test Complete!")
        
    except Exception as e:
        logger.error(f"Analyst Agent test failed: {e}")

if __name__ == "__main__":
    asyncio.run(run_analyst_test())
