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

    def test_find_recent_job_returns_completed_job(self) -> None:
        """find_recent_job must return completed/failed jobs so the cron does not re-enqueue them."""
        store = InMemoryJobStore(retention_hours=1)
        job = store.create_job("proposal_review", "prop-1", submit_review=True)
        store.mark_running(job.job_id)
        store.mark_completed(job.job_id, {"status": "complete"})

        self.assertIsNone(store.find_active_job("proposal_review", "prop-1"))
        self.assertIsNotNone(store.find_recent_job("proposal_review", "prop-1"))
        self.assertEqual(store.find_recent_job("proposal_review", "prop-1").status, "completed")

    def test_find_recent_job_returns_failed_job(self) -> None:
        store = InMemoryJobStore(retention_hours=1)
        job = store.create_job("proposal_review", "prop-2", submit_review=True)
        store.mark_running(job.job_id)
        store.mark_failed(job.job_id, "pipeline error")

        self.assertIsNone(store.find_active_job("proposal_review", "prop-2"))
        self.assertIsNotNone(store.find_recent_job("proposal_review", "prop-2"))
        self.assertEqual(store.find_recent_job("proposal_review", "prop-2").status, "failed")

    def test_find_recent_job_returns_none_after_expiry(self) -> None:
        from datetime import timedelta
        store = InMemoryJobStore(retention_hours=1)
        job = store.create_job("proposal_review", "prop-3", submit_review=True)
        store.mark_running(job.job_id)
        store.mark_completed(job.job_id, {})

        # Backdate completed_at beyond the retention window to simulate expiry
        from datetime import timezone
        import datetime
        store._jobs[job.job_id].completed_at = datetime.datetime.now(timezone.utc) - timedelta(hours=2)

        self.assertIsNone(store.find_recent_job("proposal_review", "prop-3"))
