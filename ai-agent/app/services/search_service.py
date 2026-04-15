import httpx
import logging
from typing import List, Dict, Any, Optional
from app.config import settings

logger = logging.getLogger(__name__)

class SearchService:
    """ Service to handle web search using Tavily or Serper.dev. """

    @staticmethod
    async def search_tavily(query: str, max_results: int = 5) -> List[Dict[str, Any]]:
        """ Search using Tavily API (Optimized for LLMs). """
        if not settings.TAVILY_API_KEY:
            logger.warning("Tavily API key missing. Skipping search.")
            return []

        url = "https://api.tavily.com/search"
        payload = {
            "api_key": settings.TAVILY_API_KEY,
            "query": query,
            "search_depth": "advanced",
            "max_results": max_results
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                data = response.json()
                return data.get("results", [])
            except Exception as e:
                logger.error(f"Tavily search failed: {e}")
                return []

    @staticmethod
    async def search_serper(query: str, max_results: int = 5) -> List[Dict[str, Any]]:
        """ Search using Serper.dev (Google Search API). """
        if not settings.SERPER_API_KEY:
            logger.warning("Serper API key missing. Skipping search.")
            return []

        url = "https://google.serper.dev/search"
        payload = {
            "q": query,
            "num": max_results
        }
        headers = {
            "X-API-KEY": settings.SERPER_API_KEY,
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
                
                # Standardize Serper output to match Tavily-like structure (title, url, content)
                results = []
                for item in data.get("organic", []):
                    results.append({
                        "title": item.get("title"),
                        "url": item.get("link"),
                        "content": item.get("snippet")
                    })
                return results
            except Exception as e:
                logger.error(f"Serper search failed: {e}")
                return []

    async def universal_search(self, query: str, provider: Optional[str] = None) -> List[Dict[str, Any]]:
        """ 
        Unified search method. 
        Defaults to Tavily if available, else Serper.
        """
        provider = provider or ("tavily" if settings.TAVILY_API_KEY else "serper")
        
        if provider == "tavily":
            return await self.search_tavily(query)
        elif provider == "serper":
            return await self.search_serper(query)
        else:
            logger.error(f"Unsupported search provider: {provider}")
            return []
