import logging
from typing import List, Dict, Any
from app.services.base import BaseAIClient, BaseService
from app.db.mongo import get_mongodb

logger = logging.getLogger(__name__)

class ScribeAgent(BaseService, BaseAIClient):
    """
    Stage 5: The Scribe.
    Performs RAG retrieval and drafts the content based on the Architect's outline.
    """

    async def draft_article(self, game_id: str, game_title: str, outline_data: Dict[str, Any]) -> str:
        """
        Main drafting loop. Iterates through the outline and builds the article.
        """
        self.logger.info(f"Scribe starting draft for: {game_title}")
        
        full_markdown = f"# {outline_data.get('title_proposal', f'The Ultimate {game_title} Guide')}\n\n"
        
        for section in outline_data.get("outline", []):
            heading = section.get("heading")
            query = section.get("retrieval_query")
            self.logger.info(f"Drafting section: {heading} using search: {query}")
            
            # 1. Retrieve facts from MongoDB via Vector Search
            facts = await self.retrieve_knowledge(game_id, query)
            context_text = "\n".join([f"- {f}" for f in facts])
            
            # 2. Write the section content
            prompt = f"""
            Task: Write a highly engaging, SEO-optimized section for a game guide.
            
            Game: {game_title}
            Section Heading: {heading}
            Objective: {section.get('objective')}
            
            Verified Facts (Context):
            {context_text if facts else "No specific facts found, write based on general knowledge."}
            
            Guidelines:
            - Write in Markdown.
            - Focus on 'Saturation' (use common terms users search for).
            - Keep it concise but helpful.
            
            Return ONLY the body text for this section (no heading).
            """
            
            section_body = await self.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                fallback_data="[Drafting failed. Context missing.]"
            )
            
            # 3. Append to final document
            level = section.get("level", 2)
            full_markdown += f"{'#' * level} {heading}\n\n{section_body}\n\n"
            
        return full_markdown

    async def retrieve_knowledge(self, game_id: str, query: str, limit: int = 3) -> List[str]:
        """
        Performs Vector Search on MongoDB knowledge_chunks.
        """
        try:
            # 1. Generate embedding for the query
            query_embedding = await self.generate_embedding(query)
            
            # 2. Perform Vector Search query on MongoDB
            # Note: This requires a 'vector' index named 'default' on the collection
            mongodb = await get_mongodb()
            collection = mongodb["game_knowledge_chunks"]
            
            pipeline = [
                {
                    "$vectorSearch": {
                        "index": "vector_index", # Name of your Atlas Vector Index
                        "path": "embedding",
                        "queryVector": query_embedding,
                        "numCandidates": 10,
                        "limit": limit,
                        "filter": {"pg_id": str(game_id)}
                    }
                },
                {
                    "$project": {
                        "content": 1,
                        "score": {"$meta": "vectorSearchScore"}
                    }
                }
            ]
            
            cursor = collection.aggregate(pipeline)
            results = await cursor.to_list(length=limit)
            
            return [r["content"] for r in results]
            
        except Exception as e:
            self.logger.error(f"Vector retrieval failed: {e}")
            return []
