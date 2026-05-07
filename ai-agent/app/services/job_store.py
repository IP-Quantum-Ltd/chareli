from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Literal, Optional
from uuid import uuid4


JobType = Literal["proposal_review", "game_review"]
JobStatus = Literal["queued", "running", "completed", "failed"]


@dataclass
class JobRecord:
    job_id: str
    job_type: JobType
    target_id: str
    submit_review: bool
    created_at: datetime
    status: JobStatus = "queued"
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: str = ""
    result: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "job_type": self.job_type,
            "target_id": self.target_id,
            "submit_review": self.submit_review,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "status": self.status,
            "error_message": self.error_message or None,
            "result": self.result or None,
        }


class InMemoryJobStore:
    def __init__(self, retention_hours: int = 24):
        self._retention = timedelta(hours=max(retention_hours, 1))
        self._jobs: Dict[str, JobRecord] = {}

    def create_job(self, job_type: JobType, target_id: str, submit_review: bool) -> JobRecord:
        self._purge_expired()
        job = JobRecord(
            job_id=str(uuid4()),
            job_type=job_type,
            target_id=target_id,
            submit_review=submit_review,
            created_at=datetime.now(timezone.utc),
        )
        self._jobs[job.job_id] = job
        return job

    def get_job(self, job_id: str) -> Optional[JobRecord]:
        self._purge_expired()
        return self._jobs.get(job_id)

    def find_active_job(self, job_type: JobType, target_id: str) -> Optional[JobRecord]:
        self._purge_expired()
        for job in self._jobs.values():
            if job.job_type == job_type and job.target_id == target_id and job.status in {"queued", "running"}:
                return job
        return None

    def find_recent_job(self, job_type: JobType, target_id: str) -> Optional[JobRecord]:
        """Returns any non-expired job for the target regardless of status. Used by the cron
        safety-net to skip proposals already processed within the retention window."""
        self._purge_expired()
        for job in self._jobs.values():
            if job.job_type == job_type and job.target_id == target_id:
                return job
        return None

    def list_jobs(self) -> list[JobRecord]:
        self._purge_expired()
        return sorted(self._jobs.values(), key=lambda item: item.created_at, reverse=True)

    def mark_running(self, job_id: str) -> Optional[JobRecord]:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        job.error_message = ""
        return job

    def mark_completed(self, job_id: str, result: Dict[str, Any]) -> Optional[JobRecord]:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.result = result
        job.error_message = ""
        return job

    def mark_failed(self, job_id: str, error_message: str, result: Optional[Dict[str, Any]] = None) -> Optional[JobRecord]:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        job.status = "failed"
        job.completed_at = datetime.now(timezone.utc)
        job.error_message = error_message
        job.result = result or {}
        return job

    def _purge_expired(self) -> None:
        cutoff = datetime.now(timezone.utc) - self._retention
        expired_ids = [job_id for job_id, job in self._jobs.items() if job.completed_at and job.completed_at < cutoff]
        for job_id in expired_ids:
            self._jobs.pop(job_id, None)
