#!/bin/bash

# Diagnostic script to verify frontend is loading new code

echo "=========================================="
echo "Frontend Code Verification"
echo "=========================================="
echo ""

# Check if new code exists in built files
echo "1. Checking if new frontend code is built..."
if grep -r "keepalive.*true" /home/kkfergie22/chareli/Client/dist/assets/*.js 2>/dev/null; then
    echo "✅ New code found in dist folder"
else
    echo "❌ New code NOT found in dist folder"
    echo "   Run: cd /home/kkfergie22/chareli/Client && npm run build"
fi

echo ""
echo "2. Frontend dev server status:"
if pgrep -f "vite.*Client" > /dev/null; then
    echo "✅ Dev server is running"
else
    echo "❌ Dev server is NOT running"
    echo "   Run: cd /home/kkfergie22/chareli/Client && npm run dev"
fi

echo ""
echo "3. Instructions to clear browser cache:"
echo "   Option A: Hard reload"
echo "     - Press Ctrl+Shift+R (or Cmd+Shift+R on Mac)"
echo ""
echo "   Option B: Clear cache via DevTools"
echo "     - Open DevTools (F12)"
echo "     - Go to Application tab → Storage → Clear site data"
echo "     - Or Network tab → Check 'Disable cache' → Reload"
echo ""
echo "   Option C: Incognito/Private window"
echo "     - Open a new incognito window"
echo "     - Navigate to your site"
echo "     - This guarantees fresh code"
echo ""
echo "=========================================="
echo "After clearing cache, test again!"
echo "=========================================="
