# Deployment Guide

This guide walks you through deploying the Gremlin API to Cloudflare Workers.

## Prerequisites

- Cloudflare account with Workers enabled
- Wrangler CLI installed (`bun install -g wrangler`)
- Authenticated with Cloudflare (`wrangler login`)

## Initial Setup

### 1. Configure Account ID

Get your Cloudflare account ID:

```bash
wrangler whoami
```

Add it to `wrangler.toml`:

```toml
account_id = "your-account-id-here"
```

Or set it via environment variable:

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id-here"
```

### 2. Create R2 Buckets

Create separate buckets for development and production:

```bash
# Development bucket
wrangler r2 bucket create gremlin-sessions-dev

# Production bucket
wrangler r2 bucket create gremlin-sessions
```

Verify buckets were created:

```bash
wrangler r2 bucket list
```

### 3. Set API Key

Generate a secure API key:

```bash
# Generate a random key (on macOS/Linux)
openssl rand -hex 32
```

Set the API key as a secret for each environment:

```bash
# Development
wrangler secret put API_KEY --env development

# Production
wrangler secret put API_KEY --env production
```

You'll be prompted to enter the key. Store this key securely - you'll need it for API requests.

## Local Development

### 1. Create Local Environment Variables

Copy the example file:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and add your API key:

```
API_KEY=your-development-api-key
```

### 2. Start Local Development Server

```bash
bun run dev
```

The server will be available at `http://localhost:8787`.

### 3. Test the API

Test the health check endpoint:

```bash
curl http://localhost:8787/
```

Test uploading a session:

```bash
curl -X POST http://localhost:8787/v1/sessions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-development-api-key" \
  -d '{
    "header": {
      "sessionId": "test-123",
      "startTime": 1234567890,
      "device": {
        "platform": "web",
        "osVersion": "macOS 14",
        "screen": { "width": 1920, "height": 1080, "pixelRatio": 2 }
      },
      "app": {
        "name": "Test App",
        "version": "1.0.0",
        "identifier": "https://test.com"
      },
      "schemaVersion": 1
    },
    "elements": [],
    "events": [],
    "screenshots": []
  }'
```

## Deployment

### Deploy to Development

```bash
wrangler deploy --env development
```

Your API will be deployed to: `https://gremlin-api-dev.your-subdomain.workers.dev`

### Deploy to Production

```bash
wrangler deploy --env production
```

Your API will be deployed to: `https://gremlin-api.your-subdomain.workers.dev`

### Verify Deployment

Test the deployed API:

```bash
# Health check
curl https://gremlin-api.your-subdomain.workers.dev/

# Upload session (replace with your API key)
curl -X POST https://gremlin-api.your-subdomain.workers.dev/v1/sessions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d @test-session.json
```

## Custom Domains

### 1. Add a Custom Domain

```bash
wrangler domains add api.yourdomain.com --env production
```

### 2. Update DNS

Follow Cloudflare's instructions to update your DNS records.

### 3. Configure CORS

Update CORS settings in `src/index.ts` to allow your domain:

```typescript
cors({
  origin: ['https://yourdomain.com', 'https://app.yourdomain.com'],
  // ...
})
```

Redeploy after making changes:

```bash
wrangler deploy --env production
```

## Monitoring

### View Logs

```bash
# Development
wrangler tail --env development

# Production
wrangler tail --env production
```

### View Metrics

Visit the Cloudflare dashboard:

1. Go to Workers & Pages
2. Select your worker
3. View the Metrics tab

## Updating Secrets

To update the API key:

```bash
wrangler secret put API_KEY --env production
```

Note: This will immediately affect all requests. Ensure clients are updated with the new key.

## Rollback

If you need to rollback a deployment:

```bash
# View deployments
wrangler deployments list --env production

# Rollback to a specific deployment
wrangler rollback --message "Rolling back to previous version" --env production
```

## Troubleshooting

### "API key authentication failed"

- Verify the API key secret is set: Check Cloudflare dashboard > Workers > Settings > Variables
- Ensure the `X-API-Key` header is being sent correctly
- Check that the API key matches what was set via `wrangler secret put`

### "R2 bucket not found"

- Verify buckets exist: `wrangler r2 bucket list`
- Check bucket names in `wrangler.toml` match created buckets
- Ensure the R2 binding name matches (`SESSIONS`)

### "CORS errors in browser"

- Update CORS origins in `src/index.ts`
- Redeploy after making changes
- Verify the browser is sending requests to the correct URL

### "Session upload fails"

- Check session validation errors in the response
- Ensure Content-Type is `application/json`
- Verify the session structure matches `GremlinSession` type
- Check Worker logs: `wrangler tail --env production`

### "Out of memory errors"

- Large sessions may exceed Worker memory limits
- Consider implementing session chunking or streaming uploads
- Check session size before uploading

## Cost Optimization

### Monitor R2 Storage

```bash
# List bucket contents
wrangler r2 object list gremlin-sessions
```

### Implement Session Retention

Consider implementing automatic deletion of old sessions:

```typescript
// Add to storage.ts
export async function deleteOldSessions(
  env: Env,
  olderThanDays: number
): Promise<number> {
  const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
  let deleted = 0;

  const result = await listSessions(env, 100);

  for (const session of result.sessions) {
    if (session.uploadedAt < cutoffTime) {
      await deleteSession(env, session.id);
      deleted++;
    }
  }

  return deleted;
}
```

Then create a scheduled Worker or run manually.

## Security Best Practices

1. **Rotate API Keys Regularly**: Update keys every 90 days
2. **Use Custom Domains**: Avoid exposing `workers.dev` URLs
3. **Configure CORS Strictly**: Only allow necessary origins
4. **Enable Rate Limiting**: Consider adding rate limiting middleware
5. **Monitor Access Logs**: Review logs regularly for suspicious activity
6. **Validate All Inputs**: Ensure session validation is strict
7. **Set Up Alerts**: Configure Cloudflare alerts for errors and usage spikes

## Next Steps

- Set up monitoring alerts in Cloudflare dashboard
- Configure custom domains for production
- Implement rate limiting for API endpoints
- Set up CI/CD for automated deployments
- Add session retention policies
- Configure backup strategy for R2 buckets
