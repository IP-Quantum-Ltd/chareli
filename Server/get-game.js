#!/usr/bin/env node
// Usage: node get-game.js games/f704b7d3-fc7b-4e88-b400-8bb06c68b6c9/game/index.html

const https = require('https');
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const s3Key = process.argv[2];
if (!s3Key) {
  console.error('Usage: node get-game.js <s3-key>');
  console.error('Example: node get-game.js games/f704b7d3.../game/index.html');
  process.exit(1);
}

const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
const url = `${base}/${s3Key}`;

console.error(`Fetching: ${url}`);

const client = url.startsWith('https') ? https : http;
client.get(url, (res) => {
  if (res.statusCode !== 200) {
    console.error(`Error: HTTP ${res.statusCode}`);
    process.exit(1);
  }
  res.pipe(process.stdout);
});
