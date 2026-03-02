# Chareli Game ZIP Processor - Cloudflare Worker

This Cloudflare Worker processes game ZIP files uploaded to R2 storage. It extracts the ZIP, uploads files to permanent storage, and notifies the backend via webhook.

## 🔒 Security Setup

### Initial Setup

1. **Copy the example configuration:**
   ```bash
   cp wrangler.toml.example wrangler.toml
   ```

2. **Get your Cloudflare Account ID:**
   - Go to https://dash.cloudflare.com/
   - Find your Account ID in the right sidebar
   - Update `account_id` in `wrangler.toml`

3. **Get your R2 Bucket Name:**
   - From your `.env` file: `R2_BUCKET`
   - Update `bucket_name` in `wrangler.toml`

4. **Create KV Namespace (if not exists):**
   ```bash
   wrangler kv:namespace create "GAME_STATUS"
   ```
   - Copy the ID from the output
   - Update `id` in `wrangler.toml` under `[[kv_namespaces]]`

5. **Set Backend Webhook URL:**
   - Development: Use ngrok URL (e.g., `https://xxx.ngrok-free.app/api/internal/game-processed`)
   - Production: Use your API domain (e.g., `https://api.yourdomain.com/api/internal/game-processed`)
   - Update `BACKEND_WEBHOOK_URL` in `wrangler.toml`

6. **Set Webhook Secret:**
   ```bash
   wrangler secret put WEBHOOK_SECRET
   ```
   - Paste the value from your `.env` file: `CLOUDFLARE_WEBHOOK_SECRET`
   - This ensures only the worker can send webhooks to your backend

## 📦 Deployment

### Deploy to Cloudflare:
```bash
npm run deploy
# or
wrangler deploy
```

### View Live Logs:
```bash
npm run tail
# or
wrangler tail
```

## 🔧 How It Works

### Flow:
1. **Upload**: User uploads game ZIP → R2 (`temp-games/`)
2. **Metadata**: Backend stores `gameId` in R2 object metadata (prevents O(N) lookups)
3. **Trigger**: R2 event notification → Cloudflare Queue → Worker
4. **Extract**: Worker extracts gameId from metadata (or path fallback)
5. **Process**: Worker unzips files, uploads to R2 (`games/`)
6. **Notify**: Worker sends webhook with gameId to backend
7. **Activate**: Backend does O(1 lookup, activates game


## 🧪 Testing

1. **Start ngrok** (for local testing):
   ```bash
   ngrok http 5000
   ```

2. **Update `wrangler.toml`**:
   - Set `BACKEND_WEBHOOK_URL` to your ngrok URL

3. **Deploy worker**:
   ```bash
   npm run deploy
   ```

4. **Upload a game** via your admin panel

5. **Monitor logs**:
   ```bash
   npm run tail
   ```

6. **Check for**:
   - `✅ [METADATA] Extracted gameId from R2 metadata`
   - `📡 Sending webhook...`
   - `✅ Webhook delivered successfully`

## 📝 Environment Variables

| Variable | Description | Source |
|----------|-------------|--------|
| `BACKEND_WEBHOOK_URL` | Backend webhook endpoint | wrangler.toml |
| `WEBHOOK_SECRET` | Secret for webhook auth | wrangler secret |
| `GAMES_BUCKET` | R2 bucket binding | wrangler.toml |
| `GAME_STATUS` | KV namespace binding | wrangler.toml |

## 🔗 Related Files

- `wrangler.toml.example` - Template configuration file
- `wrangler.toml` - Your actual config (git-ignored)
- `.gitignore` - Excludes sensitive files
- `src/index.ts` - Main worker code
