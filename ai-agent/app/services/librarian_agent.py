import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from langsmith import traceable

from app.config import settings
from app.db.mongo import get_mongodb
from app.db.postgres import get_postgres_pool
from app.services.base import BaseAIClient, BaseService

logger = logging.getLogger(__name__)


class LibrarianAgent(BaseService, BaseAIClient):
    """
    Stage 2: Librarian.
    Builds a grounded context packet by combining visually verified Stage 0 evidence
    with Stage 1 SEO signals plus PostgreSQL and MongoDB retrieval.
    """

    TEXTUAL_COLUMN_HINTS = {
        "title",
        "name",
        "slug",
        "description",
        "summary",
        "instructions",
        "controls",
        "content",
        "body",
        "mechanics",
        "rules",
        "tips",
        "category",
        "categories",
        "tags",
        "keywords",
        "genre",
        "developer",
        "publisher",
        "studio",
        "author",
        "faq",
    }

    IDENTITY_COLUMN_HINTS = {"id", "game_id", "url", "source_url", "canonical_url"}

    def _trim_text(self, value: Any, limit: int = 600) -> str:
        text = " ".join(str(value or "").split())
        if len(text) <= limit:
            return text
        return text[:limit].rstrip() + "..."

    def _limit_unique(self, values: List[Any], count: int, text_limit: int = 180) -> List[str]:
        unique_values: List[str] = []
        seen = set()
        for value in values or []:
            text = self._trim_text(value, text_limit)
            if not text:
                continue
            lowered = text.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            unique_values.append(text)
            if len(unique_values) >= count:
                break
        return unique_values

    def _sanitize_identifier(self, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value or ""):
            raise ValueError(f"Unsafe SQL identifier: {value}")
        return value

    def _score_against_terms(self, text: str, terms: List[str]) -> float:
        haystack = (text or "").lower()
        if not haystack:
            return 0.0

        score = 0.0
        for term in terms:
            normalized = term.lower().strip()
            if not normalized:
                continue
            if normalized in haystack:
                score += min(4.0, 1.0 + (len(normalized.split()) * 0.4))
            else:
                pieces = [piece for piece in re.split(r"[^a-z0-9]+", normalized) if piece]
                score += sum(0.25 for piece in pieces if piece in haystack)
        return round(score, 2)

    def _derive_queries(
        self,
        game_title: str,
        investigation: Dict[str, Any],
        seo_blueprint: Dict[str, Any],
    ) -> List[str]:
        best_match = investigation.get("best_match") or {}
        metadata = best_match.get("metadata") or {}
        terms: List[str] = [game_title]
        terms.extend((seo_blueprint.get("primary_keywords") or [])[:4])
        terms.extend((seo_blueprint.get("secondary_keywords") or [])[:4])
        terms.extend((seo_blueprint.get("semantic_entities") or [])[:6])
        terms.extend((metadata.get("categories") or [])[:4])
        terms.extend((metadata.get("tags") or [])[:6])
        terms.extend((metadata.get("developer_mentions") or [])[:3])
        terms.extend((best_match.get("extracted_facts") or {}).values())
        return self._limit_unique(terms, 12, 120)

    def _summarize_doc(self, doc: Dict[str, Any], text_fields: List[str]) -> str:
        parts: List[str] = []
        for field in text_fields:
            value = doc.get(field)
            if isinstance(value, list):
                value = ", ".join(str(item) for item in value[:10])
            if value:
                parts.append(f"{field}: {self._trim_text(value, 400)}")
        return " | ".join(parts)

    def _build_rag_source_text(
        self,
        game_title: str,
        investigation: Dict[str, Any],
        seo_blueprint: Dict[str, Any],
    ) -> str:
        best_match = investigation.get("best_match") or {}
        metadata = best_match.get("metadata") or {}
        facts = best_match.get("extracted_facts") or {}
        key_sections = metadata.get("key_sections") or {}

        text_parts = [
            f"Game title: {game_title}",
            f"Source URL: {best_match.get('url', '')}",
            f"Source title: {metadata.get('title', '')}",
            f"Meta description: {metadata.get('meta_description', '')}",
            f"Reasoning: {best_match.get('reasoning', '')}",
            f"Controls: {facts.get('controls', '')}",
            f"Rules: {facts.get('rules', '')}",
            f"Developer: {facts.get('original_developer', '')}",
            "Categories: " + ", ".join(metadata.get("categories") or []),
            "Tags: " + ", ".join(metadata.get("tags") or []),
            "Primary keywords: " + ", ".join(seo_blueprint.get("primary_keywords") or []),
            "Secondary keywords: " + ", ".join(seo_blueprint.get("secondary_keywords") or []),
            "Semantic entities: " + ", ".join(seo_blueprint.get("semantic_entities") or []),
        ]

        for section_name in ("about", "how_to_play", "controls", "faq", "developer", "features"):
            section = key_sections.get(section_name) or {}
            section_text = section.get("text", "") if isinstance(section, dict) else ""
            if section_text:
                text_parts.append(f"{section_name}: {section_text}")

        for faq_item in (metadata.get("faq_items") or [])[:8]:
            if not isinstance(faq_item, dict):
                continue
            question = faq_item.get("question", "")
            answer = faq_item.get("answer", "")
            if question or answer:
                text_parts.append(f"FAQ: {question} {answer}".strip())

        for block in (metadata.get("content_blocks") or [])[:20]:
            text_parts.append(str(block))

        return self._trim_text("\n".join(part for part in text_parts if part.strip()), 12000)

    def _build_rag_document(
        self,
        game_title: str,
        investigation: Dict[str, Any],
        seo_blueprint: Dict[str, Any],
        content: str,
        embedding: List[float],
    ) -> Dict[str, Any]:
        best_match = investigation.get("best_match") or {}
        metadata = best_match.get("metadata") or {}
        source_url = best_match.get("url", "")
        source_domain = urlparse(source_url).netloc

        return {
            "document_type": "verified_game_grounding",
            "game_title": game_title,
            "source_url": source_url,
            "source_domain": source_domain,
            "confidence_score": int(best_match.get("confidence_score") or 0),
            "reasoning": self._trim_text(best_match.get("reasoning", ""), 2000),
            "verified_facts": best_match.get("extracted_facts") or {},
            "metadata": {
                "title": metadata.get("title", ""),
                "meta_description": self._trim_text(metadata.get("meta_description", ""), 600),
                "categories": metadata.get("categories") or [],
                "tags": metadata.get("tags") or [],
                "developer_mentions": metadata.get("developer_mentions") or [],
                "faq_items": (metadata.get("faq_items") or [])[:10],
            },
            "seo_blueprint": {
                "primary_keywords": seo_blueprint.get("primary_keywords") or [],
                "secondary_keywords": seo_blueprint.get("secondary_keywords") or [],
                "semantic_entities": seo_blueprint.get("semantic_entities") or [],
                "content_angles": seo_blueprint.get("content_angles") or [],
                "faq_opportunities": seo_blueprint.get("faq_opportunities") or [],
            },
            "content": content,
            "embedding": embedding,
            "embedding_model": settings.EMBEDDING_MODEL,
            "last_updated": datetime.now(timezone.utc),
        }

    async def _persist_best_match_to_mongo(
        self,
        game_title: str,
        investigation: Dict[str, Any],
        seo_blueprint: Dict[str, Any],
    ) -> Dict[str, Any]:
        try:
            db = await get_mongodb()
        except Exception as exc:
            logger.warning(f"Stage 2 Mongo persistence connection failed: {exc}")
            return {"status": "error", "reason": str(exc)}

        if db is None:
            return {"status": "disabled", "reason": "MongoDB is not configured."}

        best_match = investigation.get("best_match") or {}
        source_url = best_match.get("url", "")
        if not source_url:
            return {"status": "disabled", "reason": "No best-match URL available for Mongo persistence."}

        content = self._build_rag_source_text(game_title, investigation, seo_blueprint)
        embedding = await self.generate_embedding(content, settings.EMBEDDING_MODEL)
        if not embedding or not any(embedding):
            return {"status": "error", "reason": "Embedding generation failed for Mongo persistence."}

        collection = db[settings.MONGODB_RAG_COLLECTION]
        document = self._build_rag_document(game_title, investigation, seo_blueprint, content, embedding)

        try:
            await collection.update_one(
                {"source_url": source_url, "game_title": game_title},
                {"$set": document},
                upsert=True,
            )
        except Exception as exc:
            logger.warning(f"Stage 2 Mongo persistence failed: {exc}")
            return {"status": "error", "reason": str(exc)}

        return {
            "status": "success",
            "collection": settings.MONGODB_RAG_COLLECTION,
            "source_url": source_url,
            "embedding_dimensions": len(embedding),
        }

    async def _fetch_postgres_context(self, queries: List[str]) -> Dict[str, Any]:
        pool = await get_postgres_pool()
        if pool is None:
            return {"status": "disabled", "reason": "Postgres is not configured.", "results": []}

        results: List[Dict[str, Any]] = []
        inspected_tables: List[str] = []

        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT table_name, column_name, data_type
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                    ORDER BY table_name, ordinal_position
                    """
                )
                table_map: Dict[str, List[Tuple[str, str]]] = {}
                for row in rows:
                    table_map.setdefault(row["table_name"], []).append((row["column_name"], row["data_type"]))

                prioritized_tables = sorted(
                    table_map.items(),
                    key=lambda item: (
                        0
                        if any(
                            hint in item[0].lower()
                            for hint in ("game", "proposal", "metadata", "content", "knowledge")
                        )
                        else 1,
                        item[0],
                    ),
                )

                for table_name, columns in prioritized_tables[:10]:
                    text_columns = [
                        name
                        for name, data_type in columns
                        if data_type in ("text", "character varying", "character")
                        and name.lower() in self.TEXTUAL_COLUMN_HINTS
                    ]
                    identity_columns = [
                        name for name, _ in columns if name.lower() in self.IDENTITY_COLUMN_HINTS
                    ]
                    if not text_columns:
                        continue

                    inspected_tables.append(table_name)
                    safe_table = self._sanitize_identifier(table_name)
                    selected_columns = []
                    for column in [*identity_columns[:3], *text_columns[:8]]:
                        if column not in selected_columns:
                            selected_columns.append(column)
                    selected_sql = ", ".join(f'"{self._sanitize_identifier(column)}"' for column in selected_columns)

                    where_parts: List[str] = []
                    args: List[Any] = []
                    placeholder_index = 1
                    active_queries = queries[:5]
                    for column in text_columns[:4]:
                        safe_column = self._sanitize_identifier(column)
                        for query in active_queries:
                            where_parts.append(f'"{safe_column}" ILIKE ${placeholder_index}')
                            args.append(f"%{query}%")
                            placeholder_index += 1

                    if not where_parts:
                        continue

                    sql = (
                        f'SELECT {selected_sql} FROM public."{safe_table}" '
                        f"WHERE {' OR '.join(where_parts)} LIMIT 5"
                    )

                    try:
                        matched_rows = await conn.fetch(sql, *args)
                    except Exception as exc:
                        logger.warning(f"Stage 2 Postgres search skipped table {table_name}: {exc}")
                        continue

                    for row in matched_rows:
                        record = dict(row)
                        snippet = self._summarize_doc(record, text_columns[:6])
                        score = self._score_against_terms(snippet, queries)
                        results.append(
                            {
                                "table": table_name,
                                "score": score,
                                "snippet": snippet,
                                "record": {key: self._trim_text(value, 500) for key, value in record.items()},
                            }
                        )

        except Exception as exc:
            logger.warning(f"Stage 2 Postgres retrieval failed: {exc}")
            return {"status": "error", "reason": str(exc), "results": [], "tables": inspected_tables}

        results.sort(key=lambda item: item.get("score", 0), reverse=True)
        return {
            "status": "success",
            "tables": inspected_tables,
            "results": results[:12],
        }

    def _mongo_doc_to_text(self, doc: Any, max_items: int = 20) -> str:
        snippets: List[str] = []

        def walk(node: Any, prefix: str = "") -> None:
            if len(snippets) >= max_items:
                return
            if isinstance(node, dict):
                for key, value in node.items():
                    if str(key).startswith("_"):
                        continue
                    walk(value, f"{prefix}{key}.")
                    if len(snippets) >= max_items:
                        return
            elif isinstance(node, list):
                for item in node[:6]:
                    walk(item, prefix)
                    if len(snippets) >= max_items:
                        return
            elif isinstance(node, (str, int, float, bool)):
                text = self._trim_text(node, 300)
                if text:
                    field = prefix[:-1] if prefix.endswith(".") else prefix
                    snippets.append(f"{field}: {text}" if field else text)

        walk(doc)
        return " | ".join(snippets[:max_items])

    async def _fetch_mongo_context(self, queries: List[str]) -> Dict[str, Any]:
        if not queries:
            return {"status": "disabled", "reason": "No retrieval queries were generated.", "results": []}

        try:
            db = await get_mongodb()
        except Exception as exc:
            logger.warning(f"Stage 2 Mongo connection failed: {exc}")
            return {"status": "error", "reason": str(exc), "results": []}

        if db is None:
            return {"status": "disabled", "reason": "MongoDB is not configured.", "results": []}

        try:
            collection_names = await db.list_collection_names()
        except Exception as exc:
            logger.warning(f"Stage 2 Mongo list_collection_names failed: {exc}")
            return {"status": "error", "reason": str(exc), "results": []}

        prioritized_collections = sorted(
            collection_names,
            key=lambda name: (
                0 if name == settings.MONGODB_RAG_COLLECTION else 1,
                0 if any(hint in name.lower() for hint in ("game", "summary", "knowledge", "chunk")) else 1,
                name,
            ),
        )

        results: List[Dict[str, Any]] = []
        active_queries = queries[:5]
        field_candidates = ["title", "name", "summary", "content", "description", "text", "body"]

        if settings.MONGODB_RAG_COLLECTION in collection_names:
            query_text = " ".join(active_queries)
            query_embedding = await self.generate_embedding(query_text, settings.EMBEDDING_MODEL)
            if query_embedding and any(query_embedding):
                try:
                    vector_results = await db[settings.MONGODB_RAG_COLLECTION].aggregate(
                        [
                            {
                                "$vectorSearch": {
                                    "index": settings.MONGODB_VECTOR_INDEX,
                                    "path": "embedding",
                                    "queryVector": query_embedding,
                                    "numCandidates": 20,
                                    "limit": 5,
                                }
                            },
                            {
                                "$project": {
                                    "_id": 0,
                                    "game_title": 1,
                                    "source_url": 1,
                                    "source_domain": 1,
                                    "content": 1,
                                    "confidence_score": 1,
                                    "verified_facts": 1,
                                    "metadata": 1,
                                    "seo_blueprint": 1,
                                    "score": {"$meta": "vectorSearchScore"},
                                }
                            },
                        ]
                    ).to_list(length=5)
                    for doc in vector_results:
                        snippet = self._trim_text(doc.get("content", ""), 500)
                        results.append(
                            {
                                "collection": settings.MONGODB_RAG_COLLECTION,
                                "score": round(float(doc.get("score", 0.0) or 0.0), 4),
                                "snippet": snippet,
                                "document": doc,
                                "retrieval_mode": "vector",
                            }
                        )
                except Exception as exc:
                    logger.warning(f"Stage 2 Mongo vector search unavailable, falling back to text search: {exc}")

        for collection_name in prioritized_collections[:8]:
            if collection_name == settings.MONGODB_RAG_COLLECTION and results:
                continue
            collection = db[collection_name]
            search_filters = []
            for query in active_queries:
                regex = {"$regex": re.escape(query), "$options": "i"}
                for field in field_candidates:
                    search_filters.append({field: regex})

            if not search_filters:
                continue

            try:
                cursor = collection.find({"$or": search_filters}).limit(5)
                docs = await cursor.to_list(length=5)
            except Exception as exc:
                logger.warning(f"Stage 2 Mongo search skipped collection {collection_name}: {exc}")
                continue

            for doc in docs:
                normalized_doc = {key: value for key, value in doc.items() if key != "_id"}
                snippet = self._mongo_doc_to_text(normalized_doc)
                score = self._score_against_terms(snippet, queries)
                results.append(
                    {
                        "collection": collection_name,
                        "score": score,
                        "snippet": snippet,
                        "document": normalized_doc,
                        "retrieval_mode": "text",
                    }
                )

        results.sort(key=lambda item: item.get("score", 0), reverse=True)
        return {
            "status": "success",
            "collections": prioritized_collections[:8],
            "results": results[:12],
        }

    def _build_fallback_context(
        self,
        game_title: str,
        investigation: Dict[str, Any],
        seo_blueprint: Dict[str, Any],
        retrieval_queries: List[str],
        postgres_context: Dict[str, Any],
        mongo_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        best_match = investigation.get("best_match") or {}
        metadata = best_match.get("metadata") or {}
        facts = best_match.get("extracted_facts") or {}
        faq_items = metadata.get("faq_items") or []
        return {
            "canonical_identity": {
                "game_title": game_title,
                "source_url": best_match.get("url", ""),
                "source_domain": urlparse(best_match.get("url", "")).netloc,
                "confidence_score": best_match.get("confidence_score", 0),
            },
            "grounded_gameplay": {
                "controls": facts.get("controls", ""),
                "rules": facts.get("rules", ""),
                "developer": facts.get("original_developer", ""),
                "page_summary": self._trim_text(metadata.get("meta_description", ""), 400),
                "how_to_play_signal": self._trim_text(
                    ((metadata.get("key_sections") or {}).get("how_to_play") or {}).get("text", ""),
                    600,
                ),
            },
            "seo_support": {
                "primary_keywords": seo_blueprint.get("primary_keywords") or [],
                "secondary_keywords": seo_blueprint.get("secondary_keywords") or [],
                "faq_opportunities": seo_blueprint.get("faq_opportunities") or [],
                "content_angles": seo_blueprint.get("content_angles") or [],
            },
            "faq_evidence": faq_items[:8],
            "retrieval_queries": retrieval_queries,
            "postgres_results": postgres_context.get("results") or [],
            "mongo_results": mongo_context.get("results") or [],
            "evidence_notes": self._limit_unique(
                [
                    best_match.get("reasoning", ""),
                    metadata.get("title", ""),
                    metadata.get("meta_description", ""),
                    *((item.get("snippet", "") for item in (postgres_context.get("results") or [])[:4])),
                    *((item.get("snippet", "") for item in (mongo_context.get("results") or [])[:4])),
                ],
                12,
                260,
            ),
        }

    async def _synthesize_context(
        self,
        game_title: str,
        investigation: Dict[str, Any],
        seo_blueprint: Dict[str, Any],
        retrieval_queries: List[str],
        postgres_context: Dict[str, Any],
        mongo_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        evidence_bundle = {
            "game_title": game_title,
            "best_match": investigation.get("best_match") or {},
            "seo_blueprint": seo_blueprint,
            "retrieval_queries": retrieval_queries,
            "postgres_results": postgres_context.get("results") or [],
            "mongo_results": mongo_context.get("results") or [],
        }

        # Handle datetime serialization for JSON
        def datetime_handler(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            return str(obj)

        prompt = f"""
        Task: Stage 2 Librarian grounding for the ArcadeBox game '{game_title}'.

        Use the verified Stage 0 match, the Stage 1 SEO blueprint, and the retrieved
        Postgres/Mongo evidence to build a grounded context packet for downstream writing.

        Rules:
        - Stay faithful to the evidence bundle.
        - Prefer verified page metadata and matching retrieval results.
        - If developer/publisher data is uncertain, say "Unknown" instead of inventing it.
        - Keep the packet practical for Stage 3 and Stage 5.

        Evidence bundle:
        {json.dumps(evidence_bundle, indent=2, default=datetime_handler)}

        Return ONLY valid JSON:
        {{
          "canonical_identity": {{
            "game_title": "string",
            "source_url": "string",
            "source_domain": "string",
            "confidence_score": int
          }},
          "grounded_gameplay": {{
            "controls": "string",
            "rules": "string",
            "objective": "string",
            "developer": "string",
            "publisher": "string",
            "how_to_play": "string",
            "features": ["string"]
          }},
          "seo_support": {{
            "primary_keywords": ["string"],
            "secondary_keywords": ["string"],
            "faq_opportunities": ["string"],
            "content_angles": ["string"]
          }},
          "faq_evidence": [
            {{
              "question": "string",
              "answer": "string"
            }}
          ],
          "retrieval_queries": ["string"],
          "evidence_notes": ["string"]
        }}
        """

        return await self.chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": "You are the Stage 2 Librarian for ArcadeBox. Respond only with JSON.",
                },
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            fallback_data=self._build_fallback_context(
                game_title,
                investigation,
                seo_blueprint,
                retrieval_queries,
                postgres_context,
                mongo_context,
            ),
            metadata={"stage": "librarian_grounding"},
        )

    def _sanitize_for_json(self, data: Any) -> Any:
        """Recursively convert non-serializable objects (like datetime) to strings."""
        if isinstance(data, dict):
            return {k: self._sanitize_for_json(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self._sanitize_for_json(v) for v in data]
        elif isinstance(data, datetime):
            return data.isoformat()
        return data

    @traceable(run_type="chain", name="Grounded Context Retrieval")
    async def build_grounded_context(
        self,
        game_title: str,
        investigation: Dict[str, Any],
        seo_blueprint: Dict[str, Any],
    ) -> Dict[str, Any]:
        retrieval_queries = self._derive_queries(game_title, investigation, seo_blueprint)
        mongo_persistence = await self._persist_best_match_to_mongo(game_title, investigation, seo_blueprint)
        postgres_context = await self._fetch_postgres_context(retrieval_queries)
        mongo_context = await self._fetch_mongo_context(retrieval_queries)
        grounded_packet = await self._synthesize_context(
            game_title,
            investigation,
            seo_blueprint,
            retrieval_queries,
            postgres_context,
            mongo_context,
        )

        raw_result = {
            "status": "success",
            "retrieval_queries": retrieval_queries,
            "postgres": postgres_context,
            "mongo": mongo_context,
            "mongo_persistence": mongo_persistence,
            "grounded_packet": grounded_packet,
        }

        # Final sanitization pass to prevent serialization errors in downstream nodes (Scribe, etc.)
        return self._sanitize_for_json(raw_result)
