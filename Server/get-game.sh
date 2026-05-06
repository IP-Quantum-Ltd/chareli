#!/bin/bash
# Usage: ./get-game.sh games/f704b7d3-fc7b-4e88-b400-8bb06c68b6c9/game/index.html

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <s3-key>"
  echo "Example: $0 games/f704b7d3-fc7b-4e88-b400-8bb06c68b6c9/game/index.html"
  exit 1
fi

S3_KEY="$1"

# Load .env
export $(grep -v '^#' .env | grep -v '^$' | xargs)

# Use public CDN URL if available
if [ -n "$R2_PUBLIC_URL" ]; then
  URL="${R2_PUBLIC_URL}/${S3_KEY}"
  echo "Fetching from CDN: $URL"
  curl -L "$URL"
else
  # Fall back to S3/R2 via AWS CLI
  aws s3 cp \
    "s3://${R2_BUCKET_NAME:-$AWS_S3_BUCKET}/${S3_KEY}" \
    - \
    --endpoint-url "https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com" \
    --region auto
fi
