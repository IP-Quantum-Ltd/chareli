#!/bin/bash

# Quick verification script to test admin analytics exclusion
# Run this after performing admin activities on the site

echo "=========================================="
echo "Admin Analytics Exclusion Verification"
echo "=========================================="
echo ""

# Database credentials
export PGPASSWORD=postgres
DB_HOST=localhost
DB_PORT=54322
DB_USER=postgres
DB_NAME=postgres

echo "Checking analytics records..."
echo ""

# Query 1: Total counts
echo "1. TOTAL COUNTS:"
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "
SELECT
    COUNT(*) as total_records,
    COUNT(CASE WHEN user_id IS NOT NULL THEN 1 END) as authenticated,
    COUNT(CASE WHEN user_id IS NULL THEN 1 END) as anonymous
FROM internal.analytics;
"

# Query 2: Check for admin users
echo ""
echo "2. ADMIN USER CHECK (should be 0):"
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "
SELECT COUNT(*) as admin_analytics_count
FROM internal.analytics a
LEFT JOIN public.users u ON a.user_id = u.id
LEFT JOIN public.roles r ON u.\"roleId\" = r.id
WHERE r.name = 'admin';
"

# Query 3: Recent records with user info
echo ""
echo "3. RECENT ANALYTICS (with user roles):"
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
ORDER BY a.\"createdAt\" DESC
LIMIT 10;
"

echo ""
echo "=========================================="
echo "✅ If 'admin_analytics_count' = 0, the fix is working!"
echo "=========================================="
