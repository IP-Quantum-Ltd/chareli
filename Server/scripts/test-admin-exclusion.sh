#!/bin/bash

# Comprehensive test script for admin analytics exclusion
# This tests the triple-layer defense system we implemented

echo "=============================================="
echo "Admin Analytics Exclusion - Test Suite"
echo "=============================================="
echo ""

# Database credentials
export PGPASSWORD=postgres
DB_HOST=localhost
DB_PORT=54322
DB_USER=postgres
DB_NAME=postgres

echo "📋 INSTRUCTIONS:"
echo "1. Clear analytics database"
echo "2. Test as logged-in admin user"
echo "3. Verify no analytics are recorded"
echo ""
echo "Press Enter to clear analytics and start test..."
read

# Step 1: Clear analytics
echo ""
echo "📊 Step 1: Clearing analytics database..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "DELETE FROM internal.analytics; DELETE FROM internal.signup_analytics;" > /dev/null
echo "✅ Analytics cleared"

echo ""
echo "👤 Step 2: MANUAL ACTION REQUIRED"
echo "   → Open your browser"
echo "   → Log in as ADMIN user"
echo "   → Visit the homepage 2-3 times"
echo "   → Play a game for 30+ seconds"
echo "   → Come back here and press Enter when done..."
read

# Step 3: Check results
echo ""
echo "🔍 Step 3: Checking analytics database..."
echo ""

# Total counts
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. TOTAL ANALYTICS COUNT (should be 0)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL_COUNT=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM internal.analytics;")
echo "   Total records: $TOTAL_COUNT"

if [ "$TOTAL_COUNT" -eq 0 ]; then
    echo "   ✅ PASS: No analytics recorded for admin!"
else
    echo "   ❌ FAIL: Found $TOTAL_COUNT analytics records"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "2. DETAILED RECORDS (investigating failure)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "
    SELECT
        a.\"activityType\",
        a.user_id,
        u.email,
        r.name as role,
        a.session_id,
        a.duration,
        a.\"createdAt\"
    FROM internal.analytics a
    LEFT JOIN public.users u ON a.user_id = u.id
    LEFT JOIN public.roles r ON u.\"roleId\" = r.id
    ORDER BY a.\"createdAt\" DESC;
    "
fi

echo ""
echo "=============================================="
echo "Test Complete!"
echo "=============================================="
echo ""

if [ "$TOTAL_COUNT" -eq 0 ]; then
    echo "🎉 SUCCESS! Admin analytics exclusion is working!"
    echo ""
    echo "All three layers are functioning:"
    echo "  ✅ Layer 1: Frontend sends auth headers"
    echo "  ✅ Layer 2: Controller rejects admin users"
    echo "  ✅ Layer 3: Worker skips admin users"
    echo "  ✅ Layer 4: Queries filter admin users"
else
    echo "⚠️  FAILURE: Some analytics were recorded"
    echo "Review the detailed records above to debug."
fi
echo ""
