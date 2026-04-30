import unittest

from app.services.job_store import InMemoryJobStore


class JobStoreTests(unittest.TestCase):
    def test_tracks_job_lifecycle(self) -> None:
        store = InMemoryJobStore(retention_hours=1)

        job = store.create_job("game_review", "game-1", submit_review=False)
        self.assertEqual(job.status, "queued")
        self.assertEqual(store.find_active_job("game_review", "game-1").job_id, job.job_id)

        store.mark_running(job.job_id)
        self.assertEqual(store.get_job(job.job_id).status, "running")

        store.mark_completed(job.job_id, {"status": "complete"})
        completed_job = store.get_job(job.job_id)
        self.assertEqual(completed_job.status, "completed")
        self.assertEqual(completed_job.result["status"], "complete")
