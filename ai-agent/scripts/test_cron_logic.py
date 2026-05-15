"""
Validates the cron_scan filtering logic:
- proposals created before process startup are ignored
- proposals already fully reviewed by the agent are skipped
- only new, unreviewed proposals are enqueued
"""
from datetime import datetime, timezone, timedelta

process_start = datetime.now(timezone.utc)
SERVICE_USER_ID = "agent-svc"

proposals = [
    # old — created before startup, should be ignored regardless
    {"id": "old-human",   "editorId": "human-user", "createdAt": (process_start - timedelta(hours=2)).isoformat(),   "proposedData": {}},
    {"id": "old-agent",   "editorId": "agent-svc",  "createdAt": (process_start - timedelta(hours=1)).isoformat(),   "proposedData": {"aiReview": {"recommendation": "approve"}}},
    # new + unreviewed — should be enqueued
    {"id": "new-1",       "editorId": "human-user", "createdAt": (process_start + timedelta(minutes=5)).isoformat(),  "proposedData": {}},
    {"id": "new-2",       "editorId": "human-user", "createdAt": (process_start + timedelta(minutes=10)).isoformat(), "proposedData": {}},
    # new + already reviewed by agent — should be skipped
    {"id": "new-reviewed","editorId": "agent-svc",  "createdAt": (process_start + timedelta(minutes=3)).isoformat(),  "proposedData": {"aiReview": {"recommendation": "approve"}}},
]


def _parse_dt(p):
    raw = p.get("createdAt")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


enqueued, skipped, ignored = [], [], []

for p in proposals:
    created_at = _parse_dt(p)
    if created_at is not None and created_at < process_start:
        ignored.append(p["id"])
        continue
    proposed_data = p.get("proposedData") or {}
    if p.get("editorId") == SERVICE_USER_ID and proposed_data.get("aiReview"):
        skipped.append(p["id"])
        continue
    enqueued.append(p["id"])

print(f"Total proposals : {len(proposals)}")
print(f"Pre-startup ignored  ({len(ignored)}): {ignored}")
print(f"Agent-reviewed skipped ({len(skipped)}): {skipped}")
print(f"Enqueued ({len(enqueued)}): {enqueued}")
print()

assert ignored == ["old-human", "old-agent"], f"FAIL ignored: {ignored}"
assert skipped == ["new-reviewed"],            f"FAIL skipped: {skipped}"
assert enqueued == ["new-1", "new-2"],         f"FAIL enqueued: {enqueued}"

print("ALL ASSERTIONS PASSED")
