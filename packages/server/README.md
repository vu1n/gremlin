# @gremlin/server

Cloudflare Workers API for Gremlin session storage and retrieval.

## Overview

This package provides a REST API for uploading, retrieving, listing, and deleting Gremlin session recordings. Sessions are stored in Cloudflare R2 for scalable, low-cost object storage.

## Features

- **Session Upload**: Accept JSON session data and store in R2
- **Session Retrieval**: Fetch full session data or metadata-only
- **Session Listing**: Paginated list of all sessions with summaries
- **Session Deletion**: Permanently remove sessions
- **API Key Authentication**: Simple bearer token auth via `X-API-Key` header
- **CORS Support**: Ready for browser uploads
- **Compression**: Automatic gzip compression for responses

## API Endpoints

### `GET /`
Health check and API information.

**Response:**
```json
{
  "name": "Gremlin API",
  "version": "0.0.1",
  "endpoints": {
    "upload": "POST /v1/sessions",
    "get": "GET /v1/sessions/:id",
    "list": "GET /v1/sessions",
    "delete": "DELETE /v1/sessions/:id"
  }
}
```

### `POST /v1/sessions`
Upload a new session recording.

**Headers:**
- `Content-Type: application/json`
- `X-API-Key: <your-api-key>`

**Body:** Full `GremlinSession` object (see `@gremlin/core/session/types`)

**Response (201):**
```json
{
  "id": "session-id",
  "uploadedAt": 1234567890,
  "size": 12345
}
```

### `GET /v1/sessions/:id`
Retrieve a session by ID.

**Headers:**
- `X-API-Key: <your-api-key>`

**Query Parameters:**
- `metadata=true` - Return only metadata (faster, smaller)

**Response (200):**
Full `GremlinSession` object or `SessionSummary` if `metadata=true`

### `GET /v1/sessions`
List all sessions with pagination.

**Headers:**
- `X-API-Key: <your-api-key>`

**Query Parameters:**
- `limit` - Number of sessions to return (default: 20, max: 100)
- `cursor` - Pagination cursor from previous response

**Response (200):**
```json
{
  "sessions": [
    {
      "id": "session-id",
      "startTime": 1234567890,
      "endTime": 1234567900,
      "duration": 10000,
      "platform": "web",
      "appName": "My App",
      "appVersion": "1.0.0",
      "eventCount": 42,
      "screenshotCount": 5,
      "size": 12345,
      "uploadedAt": 1234567890
    }
  ],
  "cursor": "next-page-cursor",
  "hasMore": true
}
```

### `DELETE /v1/sessions/:id`
Delete a session permanently.

**Headers:**
- `X-API-Key: <your-api-key>`

**Response (200):**
```json
{
  "deleted": true,
  "id": "session-id"
}
```

## Setup

### 1. Install Dependencies

```bash
bun install
```

### 2. Create R2 Buckets

```bash
# Development bucket
wrangler r2 bucket create gremlin-sessions-dev

# Production bucket
wrangler r2 bucket create gremlin-sessions
```

### 3. Set API Key Secret

```bash
# Development
wrangler secret put API_KEY --env development

# Production
wrangler secret put API_KEY --env production
```

### 4. Configure Account ID

Update `wrangler.toml` with your Cloudflare account ID:

```toml
account_id = "your-account-id"
```

Or set via environment variable:

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
```

## Development

### Local Development

```bash
bun run dev
```

This starts a local development server with hot reload. The server will be available at `http://localhost:8787`.

### Type Checking

```bash
bun run lint
```

### Testing

```bash
bun test
```

## Deployment

### Deploy to Development

```bash
wrangler deploy --env development
```

### Deploy to Production

```bash
wrangler deploy --env production
```

## Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `API_KEY` | Secret | API key for authentication (set via `wrangler secret put`) |

## R2 Bucket Structure

Sessions are stored in R2 with the following structure:

```
sessions/
  {session-id}.json  - Full session data
```

Each object includes custom metadata:

- `sessionId` - Session identifier
- `startTime` - Session start timestamp
- `endTime` - Session end timestamp
- `platform` - Device platform
- `appName` - Application name
- `appVersion` - Application version
- `eventCount` - Number of events
- `screenshotCount` - Number of screenshots
- `uploadedAt` - Upload timestamp
- `schemaVersion` - Session schema version

This metadata enables fast listing and filtering without downloading full sessions.

## Error Handling

All errors return a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

Common error codes:

- `UNAUTHORIZED` (401) - Missing API key
- `FORBIDDEN` (403) - Invalid API key
- `NOT_FOUND` (404) - Session not found
- `INVALID_REQUEST` (400) - Invalid request parameters
- `INVALID_SESSION` (400) - Session validation failed
- `INVALID_CONTENT_TYPE` (400) - Wrong content type
- `INTERNAL_ERROR` (500) - Server error

## Architecture

### Storage Layer (`storage.ts`)

Handles all R2 operations:
- `storeSession()` - Store session with metadata
- `getSession()` - Retrieve full session
- `getSessionMetadata()` - Fast metadata-only retrieval
- `listSessions()` - Paginated session listing
- `deleteSession()` - Remove session

### Types (`types.ts`)

TypeScript types for:
- Cloudflare Workers environment bindings
- API request/response types
- Session validation

### API (`index.ts`)

Hono-based REST API with:
- CORS middleware
- Compression middleware
- API key authentication
- Route handlers
- Error handling

## Security

- **API Key Authentication**: All endpoints (except `/`) require a valid API key
- **CORS Configuration**: Configure allowed origins in production
- **Input Validation**: All session uploads are validated before storage
- **Error Sanitization**: Internal errors don't leak sensitive information

## Performance

- **Metadata Queries**: Use `?metadata=true` for fast session info without downloading full data
- **Pagination**: List endpoints use cursor-based pagination for efficient large dataset handling
- **Compression**: Responses are automatically compressed
- **R2 Custom Metadata**: Enables fast filtering without object downloads

## Limits

- Maximum session size: Determined by Workers request size limits (~100MB)
- List pagination: Maximum 100 sessions per request
- CPU time: 50ms per request (configurable in `wrangler.toml`)

## License

MIT
