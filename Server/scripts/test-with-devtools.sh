#!/bin/bash

echo "=========================================="
echo "Testing Admin Analytics Exclusion"
echo "=========================================="
echo ""
echo "✅ Database cleared"
echo "✅ Redis flushed"
echo "✅ Vite serving new code with keepalive"
echo ""
echo "CRITICAL: Check Browser Network Tab"
echo "=========================================="
echo ""
echo "Before testing, please verify in your browser:"
echo ""
echo "1. Open DevTools (F12)"
echo "2. Go to Network tab"
echo "3. Check 'Disable cache' ✓"
echo "4. Clear (trash icon)"
echo "5. Refresh the page (F5)"
echo ""
echo "6. Perform homepage visit"
echo "7. Look for: POST /api/analytics/homepage-visit"
echo "8. Click it → Headers tab"
echo "9. Check Request Headers section"
echo ""
echo "Expected to see:"
echo "  Authorization: Bearer eyJhbG..."
echo ""
echo "If Authorization header is MISSING:"
echo "  → Browser still using cached JS"
echo "  → Try: Ctrl+Shift+Delete → Clear cache → Reload"
echo ""
echo "If Authorization header is PRESENT:"
echo "  → Frontend fix is working!"
echo "  → Check server logs for controller rejection"
echo "  → Database should have 0 records"
echo ""
echo "Press Enter to check database..."
read

echo ""
echo "Current database status:"
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres -c "
SELECT
    COUNT(*) as total_records,
    COUNT(CASE WHEN user_id IS NOT NULL THEN 1 END) as with_userid,
    COUNT(CASE WHEN session_id IS NOT NULL AND user_id IS NULL THEN 1 END) as anonymous_only
FROM internal.analytics;
"

echo ""
echo "Recent analytics:"
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres -c "
SELECT
    a.\"activityType\",
    CASE WHEN a.user_id IS NOT NULL THEN 'YES' ELSE 'NO' END as has_userid,
    r.name as role,
    a.\"createdAt\"
FROM internal.analytics a
LEFT JOIN public.users u ON a.user_id = u.id
LEFT JOIN public.roles r ON u.\"roleId\" = r.id
ORDER BY a.\"createdAt\" DESC
LIMIT 5;
"

echo ""
echo "=========================================="
echo "If you see records with has_userid='NO':"
echo "  → Authorization header not being sent"
echo "  → Clear browser cache more aggressively"
echo ""
echo "If you see records with has_userid='YES':"
echo "  → Frontend is working!"
echo "  → But controller didn't reject (investigate)"
echo ""
echo "If you see 0 records:"
echo "  → 🎉 SUCCESS! Admin exclusion working!"
echo "=========================================="
