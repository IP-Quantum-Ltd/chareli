"""Async S3 / R2 storage service for AI-agent pipeline artifacts.

Uses boto3 wrapped in asyncio.to_thread — consistent with how the rest of the
codebase handles blocking I/O (DB, filesystem, Playwright).

Supports three providers selectable via STORAGE_PROVIDER:
  s3    — AWS S3 (credentials from env or ECS task role)
  r2    — Cloudflare R2 (S3-compatible, credentials always required)
  local — Local filesystem fallback for development without real object storage
"""

import asyncio
import json
import logging
import shutil
from pathlib import Path
from typing import Optional

from app.config.runtime_config import StorageConfig

logger = logging.getLogger(__name__)


class S3StorageService:
    """Upload, download, and delete artifacts from S3-compatible object storage."""

    def __init__(self, config: StorageConfig):
        self._config = config
        self._bucket = config.bucket
        self._prefix = config.prefix.strip("/")

        if config.provider == "local":
            self._local_root = Path(config.local_root)
            self._client = None
            logger.info("Storage | provider=local root=%s", self._local_root)
            return

        # Lazy import so the module loads without boto3 when provider=local
        import boto3
        from botocore.config import Config as BotocoreConfig

        addressing_style = "path" if config.force_path_style else "auto"
        retry_config = BotocoreConfig(
            retries={"max_attempts": 3, "mode": "adaptive"},
            signature_version="s3v4",
            s3={"addressing_style": addressing_style},
        )

        client_kwargs: dict = {
            "region_name": config.region,
            "config": retry_config,
        }
        if config.access_key_id and config.secret_access_key:
            client_kwargs["aws_access_key_id"] = config.access_key_id
            client_kwargs["aws_secret_access_key"] = config.secret_access_key
        if config.endpoint_url:
            client_kwargs["endpoint_url"] = config.endpoint_url

        self._client = boto3.client("s3", **client_kwargs)
        self._local_root = None
        logger.info(
            "Storage | provider=%s bucket=%s prefix=%s endpoint=%s",
            config.provider,
            config.bucket,
            self._prefix,
            config.endpoint_url or "default",
        )

    # ------------------------------------------------------------------
    # Key construction
    # ------------------------------------------------------------------

    def proposal_key(self, proposal_id: str, *parts: str) -> str:
        """Return the full S3 key for a proposal artifact.

        Example: proposal_key("abc", "external", "candidate_01_render.png")
                 → "ai-agent/stage0/abc/external/candidate_01_render.png"
        """
        segments = [self._prefix, proposal_id, *parts] if self._prefix else [proposal_id, *parts]
        return "/".join(s.strip("/") for s in segments if s)

    async def image_url(self, key: str, expires_in: int = 3600) -> str:
        """Return a URL to pass directly to vision LLMs — no base64, no memory overhead.

        s3 / r2  → presigned HTTPS URL (valid for *expires_in* seconds)
        local    → data: URI built from the file on disk (dev fallback only)
        """
        if self._config.provider == "local":
            import base64 as _b64
            data = await self._local_read(key)
            return f"data:image/png;base64,{_b64.b64encode(data).decode()}"
        url: str = await asyncio.to_thread(
            self._client.generate_presigned_url,
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expires_in,
        )
        return url

    def public_url(self, key: str) -> str:
        """Return the public-facing URL for a stored key."""
        if self._config.public_url:
            return f"{self._config.public_url.rstrip('/')}/{key}"
        return f"https://{self._bucket}.s3.{self._config.region}.amazonaws.com/{key}"

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------

    async def upload(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        """Upload raw bytes to *key*. Returns the key."""
        if self._config.provider == "local":
            return await self._local_write(key, data)

        await asyncio.to_thread(
            self._client.put_object,
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl="private, max-age=86400",
        )
        logger.debug("S3 upload | key=%s bytes=%d", key, len(data))
        return key

    async def upload_json(self, key: str, payload: dict) -> str:
        """Serialise *payload* to JSON and upload. Returns the key."""
        data = json.dumps(payload, indent=2, default=str).encode("utf-8")
        return await self.upload(key, data, content_type="application/json; charset=utf-8")

    async def download(self, key: str) -> bytes:
        """Download and return raw bytes for *key*."""
        if self._config.provider == "local":
            return await self._local_read(key)

        response = await asyncio.to_thread(
            self._client.get_object,
            Bucket=self._bucket,
            Key=key,
        )
        body = response["Body"]
        return await asyncio.to_thread(body.read)

    async def delete(self, key: str) -> None:
        """Delete *key*. Failures are logged and swallowed — never raises."""
        if self._config.provider == "local":
            await self._local_delete(key)
            return
        try:
            await asyncio.to_thread(
                self._client.delete_object,
                Bucket=self._bucket,
                Key=key,
            )
        except Exception as exc:
            logger.warning("S3 delete failed | key=%s error=%s", key, exc)

    # ------------------------------------------------------------------
    # Local filesystem fallback (STORAGE_PROVIDER=local)
    # ------------------------------------------------------------------

    async def _local_write(self, key: str, data: bytes) -> str:
        path = self._local_root / key
        await asyncio.to_thread(path.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_bytes, data)
        logger.debug("Local write | path=%s bytes=%d", path, len(data))
        return key

    async def _local_read(self, key: str) -> bytes:
        path = self._local_root / key
        return await asyncio.to_thread(path.read_bytes)

    async def _local_delete(self, key: str) -> None:
        try:
            path = self._local_root / key
            await asyncio.to_thread(path.unlink, missing_ok=True)
        except Exception as exc:
            logger.warning("Local delete failed | key=%s error=%s", key, exc)
