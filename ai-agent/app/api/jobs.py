from fastapi import APIRouter, HTTPException

from app.domain.schemas import JobListResponse, JobStatusResponse
from app.runtime import get_runtime

router = APIRouter(prefix="/jobs")


@router.get("", tags=["Jobs"], response_model=JobListResponse)
async def list_jobs() -> JobListResponse:
    runtime = get_runtime()
    return JobListResponse(jobs=[JobStatusResponse(**job.to_dict()) for job in runtime.job_store.list_jobs()])


@router.get("/{job_id}", tags=["Jobs"], response_model=JobStatusResponse)
async def get_job(job_id: str) -> JobStatusResponse:
    runtime = get_runtime()
    job = runtime.job_store.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobStatusResponse(**job.to_dict())
