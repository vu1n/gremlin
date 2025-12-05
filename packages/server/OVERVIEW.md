# Gremlin Server Overview

Production-ready Cloudflare Workers API for Gremlin session storage and retrieval.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Cloudflare Workers                        │
│                                                                  │
│  ┌────────────────┐     ┌─────────────────┐    ┌─────────────┐ │
│  │   index.ts     │────▶│   storage.ts    │───▶│  R2 Bucket  │ │
│  │                │     │                 │    │             │ │
│  │ • REST API     │     │ • storeSession  │    │  sessions/  │ │
│  │ • Auth         │     │ • getSession    │    │  {id}.json  │ │
│  │ • CORS         │     │ • listSessions  │    │             │ │
│  │ • Validation   │     │ • deleteSession │    │             │ │
│  │ • Error        │     │                 │    │             │ │
│  │   Handling     │     │                 │    │             │ │
│  └────────────────┘     └─────────────────┘    └─────────────┘ │
│         │                                                        │
│         │                                                        │
│         ▼                                                        │
│  ┌────────────────┐                                             │
│  │    types.ts    │                                             │
│  │                │                                             │
│  │ • Env types    │                                             │
│  │ • API types    │                                             │
│  │ • Validation   │                                             │
│  └────────────────┘                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
packages/server/
├── src/
│   ├── index.ts          # Main API server (393 lines)
│   ├── storage.ts        # R2 storage layer (219 lines)
│   ├── types.ts          # Type definitions (202 lines)
│   └── index.test.ts     # Test suite (336 lines)
│
├── examples/
│   └── client.ts         # Example client usage (210 lines)
│
├── wrangler.toml         # Cloudflare Workers config
├── tsconfig.json         # TypeScript config
├── package.json          # Dependencies
│
├── README.md             # API documentation
├── DEPLOYMENT.md         # Deployment guide
├── OVERVIEW.md           # This file
│
├── .gitignore            # Git ignore rules
└── .dev.vars.example     # Environment variables template
```

## Key Features

### API Layer (index.ts)

- **REST API**: Full CRUD operations for sessions
- **Authentication**: API key via `X-API-Key` header
- **CORS**: Configurable cross-origin support
- **Compression**: Automatic gzip compression
- **Validation**: Schema validation before storage
- **Error Handling**: Consistent error responses

### Storage Layer (storage.ts)

- **R2 Integration**: Direct R2 object storage
- **Metadata**: Custom metadata for fast queries
- **Pagination**: Cursor-based pagination
- **Session IDs**: Unique ID generation
- **Efficient Queries**: Metadata-only queries available

### Type System (types.ts)

- **Env Types**: Cloudflare Workers environment bindings
- **API Types**: Request/response types
- **Validation**: Runtime session validation
- **Session Summaries**: Lightweight session metadata

## API Endpoints

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/` | GET | Health check | No |
| `/v1/sessions` | POST | Upload session | Yes |
| `/v1/sessions/:id` | GET | Get session | Yes |
| `/v1/sessions` | GET | List sessions | Yes |
| `/v1/sessions/:id` | DELETE | Delete session | Yes |

## Data Flow

### Upload Session

```
Client                    Worker                    R2
  │                         │                       │
  ├─ POST /v1/sessions ────▶│                       │
  │  + X-API-Key            │                       │
  │  + JSON session         │                       │
  │                         │                       │
  │                         ├─ Validate API key     │
  │                         ├─ Validate session     │
  │                         ├─ Generate ID          │
  │                         │                       │
  │                         ├─ PUT sessions/{id} ──▶│
  │                         │   + metadata          │
  │                         │                       │
  │                         │◀──────────────────────┤
  │◀─ 201 Created ──────────┤                       │
  │  { id, uploadedAt }     │                       │
```

### Retrieve Session

```
Client                    Worker                    R2
  │                         │                       │
  ├─ GET /v1/sessions/:id ─▶│                       │
  │  + X-API-Key            │                       │
  │                         │                       │
  │                         ├─ Validate API key     │
  │                         │                       │
  │                         ├─ GET sessions/{id} ──▶│
  │                         │                       │
  │                         │◀──────────────────────┤
  │                         ├─ Parse JSON           │
  │                         │                       │
  │◀─ 200 OK ───────────────┤                       │
  │  { session data }       │                       │
```

### List Sessions

```
Client                    Worker                    R2
  │                         │                       │
  ├─ GET /v1/sessions ─────▶│                       │
  │  + X-API-Key            │                       │
  │  + limit, cursor        │                       │
  │                         │                       │
  │                         ├─ Validate API key     │
  │                         │                       │
  │                         ├─ LIST sessions/ ─────▶│
  │                         │   + limit, cursor     │
  │                         │                       │
  │                         │◀──────────────────────┤
  │                         ├─ Extract metadata     │
  │                         ├─ Sort by upload time  │
  │                         │                       │
  │◀─ 200 OK ───────────────┤                       │
  │  { sessions[], cursor } │                       │
```

## Security

### Authentication

- API key required for all `/v1/*` endpoints
- Key stored as Cloudflare secret (encrypted)
- Validated on every request
- Different keys for dev/production

### CORS

- Configurable allowed origins
- Supports credentials
- Preflight request handling
- Secure defaults

### Validation

- Schema validation on upload
- Type checking with TypeScript
- Input sanitization
- Error message sanitization

## Performance

### Optimizations

- **Compression**: Automatic gzip for responses
- **Metadata Queries**: Fast listing without downloading sessions
- **Cursor Pagination**: Efficient large dataset handling
- **R2 Custom Metadata**: No object downloads for filtering
- **Edge Computing**: Low latency worldwide

### Limits

- Worker CPU: 50ms per request (configurable)
- Request body: ~100MB
- List pagination: Max 100 sessions per request
- R2 operations: Standard R2 rate limits

## Testing

### Test Suite (index.test.ts)

- **15 tests** covering all endpoints
- **42 assertions** for comprehensive coverage
- **Mock R2 bucket** for isolated testing
- **Bun test runner** for fast execution

### Test Coverage

- ✓ Health check endpoint
- ✓ API key authentication (valid/invalid/missing)
- ✓ Session upload (valid/invalid/wrong content type)
- ✓ Session retrieval (full/metadata/not found)
- ✓ Session listing (basic/pagination/invalid params)
- ✓ Session deletion (success/not found)
- ✓ Error handling (404s, validation)

### Running Tests

```bash
bun test        # Run all tests
bun run lint    # Type checking
```

## Development Workflow

### Local Development

1. Copy `.dev.vars.example` to `.dev.vars`
2. Set your API key
3. Run `bun run dev`
4. Test at `http://localhost:8787`

### Type Checking

```bash
bun run lint
```

### Deployment

```bash
# Development
wrangler deploy --env development

# Production
wrangler deploy --env production
```

## Dependencies

### Runtime Dependencies

- **hono** (^4.0.0): Fast edge framework
  - CORS middleware
  - Compression middleware
  - Type-safe routing

### Workspace Dependencies

- **@gremlin/core**: Session type definitions
- **@gremlin/proto**: Protocol buffers (future use)

### Dev Dependencies

- **@cloudflare/workers-types**: TypeScript types for Workers
- **@types/bun**: Bun runtime types
- **typescript**: Type checking
- **wrangler**: Cloudflare Workers CLI

## Environment Variables

| Variable | Type | Description | Required |
|----------|------|-------------|----------|
| `API_KEY` | Secret | API authentication key | Yes |

## R2 Storage Schema

### Bucket Structure

```
sessions/
  {session-id}.json       # Full session data
```

### Object Metadata

```javascript
{
  sessionId: string
  startTime: string       // Unix timestamp
  endTime: string         // Unix timestamp
  platform: string        // web | ios | android
  appName: string
  appVersion: string
  eventCount: string
  screenshotCount: string
  uploadedAt: string      // Unix timestamp
  schemaVersion: string
}
```

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Missing API key |
| `FORBIDDEN` | 403 | Invalid API key |
| `NOT_FOUND` | 404 | Session/endpoint not found |
| `INVALID_REQUEST` | 400 | Invalid parameters |
| `INVALID_SESSION` | 400 | Session validation failed |
| `INVALID_CONTENT_TYPE` | 400 | Wrong content type |
| `INTERNAL_ERROR` | 500 | Server error |

## Monitoring

### Logs

View real-time logs:

```bash
wrangler tail --env production
```

### Metrics

Available in Cloudflare dashboard:

- Request count
- Error rate
- Latency (P50, P95, P99)
- CPU usage
- R2 operations

### Alerts

Configure alerts for:

- Error rate spikes
- Latency increases
- R2 storage usage
- Request volume

## Future Enhancements

### Potential Additions

1. **Rate Limiting**: Per-API-key rate limits
2. **Session Compression**: Gzip session data in R2
3. **Batch Operations**: Upload/delete multiple sessions
4. **Session Search**: Filter by app, platform, date range
5. **Session Analytics**: Aggregate statistics
6. **Webhook Support**: Notify on session upload
7. **Session Retention**: Automatic cleanup policies
8. **Multi-region**: Regional R2 buckets
9. **Session Replay**: Streaming session events
10. **GraphQL API**: Alternative API format

## Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [R2 Storage Docs](https://developers.cloudflare.com/r2/)
- [Hono Framework](https://hono.dev/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

## Support

For issues or questions:

1. Check the [README.md](./README.md) for API documentation
2. Review [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment help
3. Examine tests in [index.test.ts](./src/index.test.ts) for usage examples
4. Review [client.ts](./examples/client.ts) for client implementation

## License

MIT
