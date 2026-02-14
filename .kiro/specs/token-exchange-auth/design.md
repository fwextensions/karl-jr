# Token Exchange Authentication Design

## Overview

This design replaces the current session-based authentication flow with a token exchange system that significantly improves security. Instead of sending raw Wagtail session IDs on every request, the extension performs a one-time exchange to obtain a short-lived, HMAC-signed token scoped to the companion API. The server validates tokens locally using cryptographic signatures, eliminating the need for Redis session caching and reducing Wagtail API calls by ~90%.

The token exchange flow reduces the blast radius of credential leaks from "full Wagtail admin access" to "read-only companion API access for ≤15 minutes". Raw session IDs are never stored in Redis or logged, and tokens are self-validating without external dependencies.

## Architecture

### System Flow

```
Extension                           Vercel Server                    Wagtail
   |                                     |                              |
   |  1. POST /api/auth/token            |                              |
   |     X-Wagtail-Session: <sid>        |                              |
   |------------------------------------>|                              |
   |                                     |  2. GET /api/v2/pages        |
   |                                     |     Cookie: sessionid=<sid>  |
   |                                     |----------------------------->|
   |                                     |     200 OK                   |
   |                                     |<-----------------------------|
   |                                     |                              |
   |     { token, expiresAt }            |                              |
   |<------------------------------------|                              |
   |                                     |                              |
   |  3. GET /api/feedback               |                              |
   |     Authorization: Bearer <token>   |                              |
   |------------------------------------>|                              |
   |                                     |  4. Verify HMAC signature    |
   |                                     |     (no external call)       |
   |                                     |                              |
   |     { stats, records }              |                              |
   |<------------------------------------|                              |
```

### Token Format

Tokens use a simple base64url-encoded structure with HMAC-SHA256 signatures:

```
base64url(payload) + "." + base64url(hmac)
```

**Payload Structure:**
```typescript
interface TokenPayload {
	sfp: string;  // session fingerprint: SHA-256(sessionId)
	iat: number;  // issued-at: unix timestamp in seconds
	exp: number;  // expires-at: unix timestamp in seconds
}
```

The `sfp` field stores a SHA-256 hash of the Wagtail session ID, allowing server-side association without storing the raw credential. The token never contains the session ID itself.

**Signing:**
```typescript
HMAC-SHA256(base64url(payload), TOKEN_SIGNING_SECRET)
```

### Token Lifetime

- Default TTL: 15 minutes (900 seconds)
- Configurable via `TOKEN_TTL_SECONDS` environment variable
- Extension refreshes proactively when within 60 seconds of expiry
- No refresh tokens needed - extension always has access to Wagtail session cookie

### Security Properties Comparison

| Property | Current | Proposed |
|---|---|---|
| Credential sent per request | Raw Wagtail session ID | Server-issued scoped token |
| Blast radius if token leaks | Full Wagtail admin access | Read-only companion API for ≤15 min |
| Blast radius if Redis leaks | All recent Wagtail sessions | Nothing (tokens are self-validating) |
| Wagtail roundtrips | Every cache miss (~10% of requests) | Only during token exchange |
| Sensitive data in logs | First 8 chars of session ID | Token prefix (not a Wagtail credential) |

## Components and Interfaces

### Shared Types Package

**New file: `packages/shared/src/types/auth.ts`**

```typescript
/**
 * Successful response from POST /api/auth/token
 */
export interface TokenResponse {
	/** the signed companion API token */
	token: string;
	/** ISO 8601 expiration timestamp */
	expiresAt: string;
}

/**
 * Error response from POST /api/auth/token
 */
export interface TokenErrorResponse {
	error: string;
}
```

Export from `packages/shared/src/types/index.ts`:
```typescript
export * from "./auth";
```

### Server Token Module

**New file: `packages/server/lib/token.ts`**

Handles token creation and verification using Node's built-in `crypto` module.

```typescript
interface TokenPayload {
	sfp: string;  // SHA-256(sessionId)
	iat: number;  // issued-at timestamp
	exp: number;  // expiration timestamp
}

/**
 * Creates a signed token for the given session fingerprint.
 */
export function createToken(
	sessionId: string,
	secret: string,
	ttlSeconds: number = 900
): { token: string; expiresAt: Date };

/**
 * Verifies a token's signature and expiration.
 * Returns the decoded payload if valid, or null if invalid/expired.
 */
export function verifyToken(
	token: string,
	secret: string
): TokenPayload | null;
```

**Implementation details:**
- `createToken` computes `sfp = SHA-256(sessionId)` using `crypto.createHash("sha256")`
- Signs with `crypto.createHmac("sha256", secret)`
- Encodes as `base64url(payload).base64url(hmac)`
- `verifyToken` uses `crypto.timingSafeEqual` for signature comparison
- Uses `Buffer.from(str, "base64url")` for encoding/decoding

### Server Auth Endpoint

**New file: `packages/server/api/auth/token.ts`**

Vercel serverless function at `POST /api/auth/token`.

**Request:**
- Method: `POST`
- Header: `X-Wagtail-Session: <sessionId>`
- Header: `Origin: chrome-extension://...`

**Response (200):**
```json
{
	"token": "eyJzZn...signature",
	"expiresAt": "2025-06-15T12:30:00.000Z"
}
```

**Error responses:**
- `401`: Missing or invalid Wagtail session
- `403`: Invalid origin
- `405`: Method not allowed

**Flow:**
1. Validate CORS origin
2. Check method is POST
3. Extract session ID from `X-Wagtail-Session` header
4. Validate against Wagtail using existing `validateWagtailSession`
5. If valid, create token and return `{ token, expiresAt }`
6. If invalid, return 401

**Environment variables:**
- `TOKEN_SIGNING_SECRET` (required) - HMAC key, min 32 hex chars
- `WAGTAIL_API_URL` (existing)

No Redis interaction - tokens are self-validating.

### Server Auth Library Updates

**Modified file: `packages/server/lib/auth.ts`**

Add bearer token extraction helper:

```typescript
/**
 * Extracts the bearer token from the Authorization header.
 * Returns null if the header is missing or malformed.
 */
export function extractBearerToken(req: VercelRequest): string | null {
	const header = req.headers.authorization;
	if (!header || !header.startsWith("Bearer ")) return null;
	return header.slice(7);
}
```

Existing `validateWagtailSession` remains unchanged for use by token exchange endpoint.

### Server Endpoint Updates

**Modified file: `packages/server/api/feedback.ts`**

Replace session-based auth with token-based auth:

**Before:**
```typescript
const sessionId = req.headers["x-wagtail-session"] as string | undefined;
if (!sessionId) {
	return res.status(401).json({ error: "Missing session token" });
}
// ... Redis cache lookup ...
// ... validateWagtailSession call ...
```

**After:**
```typescript
const bearerToken = extractBearerToken(req);
if (!bearerToken) {
	return res.status(401).json({ error: "Missing or invalid authorization" });
}

const tokenPayload = verifyToken(bearerToken, env.TOKEN_SIGNING_SECRET);
if (!tokenPayload) {
	return res.status(401).json({ error: "Invalid or expired token" });
}
```

**Additional changes:**
- Remove `SESSION_CACHE_TTL` constant
- Remove Redis session cache lookup/write (lines 261-284)
- Remove `validateWagtailSession` import
- Add `extractBearerToken` and `verifyToken` imports
- Add `TOKEN_SIGNING_SECRET` to `ProxyEnv` interface
- Update CORS `Access-Control-Allow-Headers` to include `Authorization`
- Update logs to use `tokenPayload.sfp.substring(0, 8)`

**Modified file: `packages/server/api/link-check.ts`**

Same pattern as feedback.ts:
- Replace `extractWagtailSessionId` + `validateWagtailSession` with `extractBearerToken` + `verifyToken`
- Remove `extractWagtailSessionId` function (lines 728-751)
- Add `TOKEN_SIGNING_SECRET` to env validation
- Update CORS headers
- Update logs to use session fingerprint

### Extension Auth Module

**New file: `packages/extension/src/api/auth.ts`**

Centralized auth module managing token lifecycle.

```typescript
// how close to expiry (in ms) before proactively refreshing
const REFRESH_MARGIN = 60_000;

// in-memory cache to avoid async storage reads on every request
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Returns a valid companion API token, performing a token exchange
 * if necessary. Throws if the user is not authenticated.
 */
export async function getAuthToken(): Promise<string>;

/**
 * Performs the one-time token exchange: sends the Wagtail session ID
 * to /api/auth/token and stores the returned token.
 */
async function exchangeToken(): Promise<string>;

/**
 * Clears the cached token. Call this on 401 responses to force
 * a fresh exchange on the next request.
 */
export async function clearAuthToken(): Promise<void>;

/**
 * Reads the Wagtail session ID from browser cookies.
 */
async function getWagtailSessionId(): Promise<string | null>;
```

**Token caching strategy:**
1. Check in-memory cache first (fast path)
2. If not in memory, check `chrome.storage.session`
3. If not cached or near expiry (< 60s), perform exchange
4. Store in both memory and `chrome.storage.session`

**Storage choice:** `chrome.storage.session` survives service worker restarts but clears when browser closes, providing the right balance of persistence and security.

### Extension API Client Updates

**Modified file: `packages/extension/src/api/airtable-client.ts`**

Replace session-based auth with token-based auth and retry-on-401:

```typescript
import { getAuthToken, clearAuthToken } from "./auth.js";

export async function getFeedback(path: string): Promise<FeedbackResponse> {
	// ... existing cache check ...

	const url = new URL(API_FEEDBACK_URL);
	url.searchParams.set("pagePath", normalizedPath);

	// attempt with current token, retry once on 401
	for (let attempt = 0; attempt < 2; attempt++) {
		const token = await getAuthToken();

		const response = await fetchWithTimeout(url.toString(), {
			headers: {
				"Authorization": `Bearer ${token}`,
				"X-SF-Gov-Extension": "companion",
			},
		});

		if (response.status === 401 && attempt === 0) {
			// token expired or revoked -- clear and retry
			await clearAuthToken();
			continue;
		}

		if (response.status === 401) {
			throw createApiError("auth", "Invalid or expired session.", 401);
		}

		// ... rest of existing response handling ...
	}
}
```

Remove `getWagtailSessionId()` function (moved to auth.ts).

**Modified file: `packages/extension/src/api/link-check-client.ts`**

Same pattern as airtable-client:
- Remove private `getWagtailSessionId()` method
- Import `getAuthToken` and `clearAuthToken` from `./auth.js`
- Replace `X-Wagtail-Session` header with `Authorization: Bearer ${token}`
- Add retry-on-401 logic

**No changes to: `packages/extension/src/api/wagtail-client.ts`**

The `getCurrentUser()` function makes direct Wagtail API calls using cookies, not companion API calls, so it continues using the existing cookie-based approach.

## Data Models

### TokenPayload

```typescript
interface TokenPayload {
	sfp: string;  // session fingerprint: SHA-256(sessionId)
	iat: number;  // issued-at: unix timestamp in seconds
	exp: number;  // expires-at: unix timestamp in seconds
}
```

**Invariants:**
- `sfp` is always a 64-character hex string (SHA-256 output)
- `iat` ≤ `exp`
- `exp` = `iat` + `ttlSeconds`

### TokenResponse

```typescript
interface TokenResponse {
	token: string;      // base64url(payload).base64url(hmac)
	expiresAt: string;  // ISO 8601 timestamp
}
```

**Invariants:**
- `token` contains exactly one dot separator
- Both parts of `token` are valid base64url strings
- `expiresAt` is a valid ISO 8601 timestamp

### CachedToken (Extension)

```typescript
interface CachedToken {
	token: string;
	expiresAt: number;  // unix timestamp in milliseconds
}
```

Stored in `chrome.storage.session` under key `"authToken"`.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system - essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Token creation produces valid fingerprints

*For any* Wagtail session ID, when creating a token, the payload SHALL contain a SHA-256 hash of the session ID and SHALL NOT contain the raw session ID anywhere in the token string.

**Validates: Requirements 1.1, 1.5**

### Property 2: Token creation includes required timestamps

*For any* token creation request, the resulting token payload SHALL contain `iat` and `exp` fields where `iat` ≤ `exp` and `exp` = `iat` + `ttlSeconds`.

**Validates: Requirements 1.2**

### Property 3: Token format is consistent

*For any* created token, the token string SHALL match the pattern `base64url.base64url` where both parts are valid base64url-encoded strings.

**Validates: Requirements 1.4**

### Property 4: Token verification is a round-trip

*For any* token created with a given secret, verifying that token with the same secret SHALL return the original payload with matching `sfp`, `iat`, and `exp` values.

**Validates: Requirements 2.6**

### Property 5: Invalid signatures are rejected

*For any* valid token, if the signature portion is modified, verification SHALL return null.

**Validates: Requirements 2.2**

### Property 6: Expired tokens are rejected

*For any* token where the current time is greater than the `exp` timestamp, verification SHALL return null.

**Validates: Requirements 2.3**

### Property 7: Malformed tokens are rejected

*For any* string that does not contain exactly one dot separator or contains non-base64url characters, verification SHALL return null.

**Validates: Requirements 2.4, 2.5**

### Property 8: Token exchange returns valid tokens for valid sessions

*For any* valid Wagtail session ID, the token exchange endpoint SHALL return a TokenResponse with a valid token and an ISO 8601 expiration timestamp.

**Validates: Requirements 3.2**

### Property 9: Token exchange rejects invalid sessions

*For any* request with a missing or invalid Wagtail session ID, the token exchange endpoint SHALL return a 401 status code.

**Validates: Requirements 3.3**

### Property 10: Token exchange validates origins

*For any* request with an origin that is not a valid extension origin, the token exchange endpoint SHALL return a 403 status code.

**Validates: Requirements 3.4**

### Property 11: Endpoints reject malformed authorization headers

*For any* request to /api/feedback or /api/link-check with a missing Authorization header or an Authorization header that does not start with "Bearer ", the endpoint SHALL return a 401 status code.

**Validates: Requirements 4.2, 5.2**

### Property 12: Endpoints reject invalid tokens

*For any* request to /api/feedback or /api/link-check with an invalid or expired bearer token, the endpoint SHALL return a 401 status code.

**Validates: Requirements 4.3, 5.3**

### Property 13: Extension caches valid tokens

*For any* sequence of authenticated requests where the token expires in more than 60 seconds, the extension SHALL use the same cached token without performing additional token exchanges.

**Validates: Requirements 6.1, 6.2**

### Property 14: Extension refreshes near-expired tokens

*For any* cached token that expires in less than 60 seconds, the extension SHALL perform a token exchange before making the next authenticated request.

**Validates: Requirements 6.3**

### Property 15: Extension retries on 401

*For any* authenticated request that receives a 401 response, the extension SHALL clear the cached token and retry the request exactly once with a fresh token.

**Validates: Requirements 6.4**

### Property 16: Token TTL respects configuration

*For any* value of TOKEN_TTL_SECONDS, tokens created SHALL have an expiration time of `iat` + TOKEN_TTL_SECONDS.

**Validates: Requirements 7.1**

### Property 17: Different secrets produce incompatible tokens

*For any* token created with secret A, verification with secret B SHALL return null.

**Validates: Requirements 7.4**

## Error Handling

### Token Exchange Errors

| Scenario | HTTP Status | Response | Extension Behavior |
|---|---|---|---|
| No session cookie | N/A | N/A | Throw "Not authenticated. Please log in to Wagtail." |
| Invalid session (401 from exchange) | 401 | `{ error: "..." }` | Throw "Invalid or expired session. Please log in to Wagtail." |
| Server error (500 from exchange) | 500 | `{ error: "..." }` | Throw "Token exchange failed: 500" |
| Network error | N/A | N/A | Throw "Check your connection" |

### Token Validation Errors

| Scenario | Server Response | Extension Behavior |
|---|---|---|
| Missing Authorization header | 401 | Clear token, retry once |
| Malformed token | 401 | Clear token, retry once |
| Expired token | 401 | Clear token, retry once |
| Invalid signature | 401 | Clear token, retry once |
| Retry also fails | 401 | Propagate auth error to UI |

### Migration Phase Errors

During the backward compatibility phase:
- If `Authorization` header present: attempt token auth
- If token auth fails: return 401 (do not fall back to session auth)
- If no `Authorization` header: fall back to legacy `X-Wagtail-Session` auth

This ensures new extension versions always use token auth, while old versions continue working.

## Testing Strategy

### Unit Tests

Unit tests focus on specific examples, edge cases, and error conditions:

**Token module (`lib/token.ts`):**
- Empty session ID handling
- Very long session IDs (>1KB)
- Session IDs with special characters
- TTL of 0 seconds (immediate expiry)
- TTL of maximum safe integer
- Token verification with empty string input
- Token verification with null/undefined input

**Auth endpoint (`api/auth/token.ts`):**
- GET/PUT/DELETE method rejection (405)
- Missing `X-Wagtail-Session` header (401)
- Invalid origin header (403)
- Wagtail API timeout handling
- Wagtail API 500 error handling

**Extension auth module (`api/auth.ts`):**
- Token exchange with no session cookie
- Token exchange with expired session
- Token exchange network timeout
- Storage API failures
- Concurrent token exchange requests

**API client updates:**
- Retry logic with 401 on first attempt
- Retry exhaustion (401 on both attempts)
- Token refresh during long-running operations

### Property-Based Tests

Property tests verify universal properties across randomized inputs. Each test runs minimum 100 iterations.

**Token creation properties:**
- Test Property 1: Generate random session IDs, verify fingerprint presence and session ID absence
- Test Property 2: Generate random TTLs, verify timestamp relationships
- Test Property 3: Verify all tokens match format pattern

**Token verification properties:**
- Test Property 4: Create random tokens, verify round-trip
- Test Property 5: Create tokens, tamper with signatures, verify rejection
- Test Property 6: Create tokens with past expiration, verify rejection
- Test Property 7: Generate malformed strings, verify rejection

**Endpoint properties:**
- Test Property 11: Generate various malformed headers, verify 401
- Test Property 12: Generate invalid tokens, verify 401

**Extension properties:**
- Test Property 13: Generate sequences of requests, verify cache reuse
- Test Property 14: Generate near-expired tokens, verify refresh
- Test Property 15: Simulate 401 responses, verify retry count

**Configuration properties:**
- Test Property 16: Generate random TTL values, verify token expiration
- Test Property 17: Create tokens with different secrets, verify incompatibility

**Test tagging format:**
```typescript
// Feature: token-exchange-auth, Property 1: Token creation produces valid fingerprints
test("token does not contain raw session ID", async () => {
	// property test implementation
});
```

### Integration Tests

- End-to-end token exchange flow with real Wagtail API (staging)
- Feedback endpoint with token auth
- Link check endpoint with token auth
- Token expiry and refresh during active session
- Service worker restart with cached token recovery
- Multiple tabs sharing token cache

### Security Validation

- Verify raw session IDs do not appear in Vercel logs
- Verify raw session IDs are not stored in Redis
- Verify stolen tokens cannot access Wagtail admin
- Verify tokens are rejected after expiry
- Verify CORS headers after migration (no `X-Wagtail-Session`)

### Migration Testing

- Deploy server with backward compatibility
- Test old extension version (session-based auth)
- Test new extension version (token-based auth)
- Verify both work simultaneously
- Remove backward compatibility
- Verify old extension fails gracefully with clear error

## Environment Variables

### New (Server)

| Variable | Required | Description | Example |
|---|---|---|---|
| `TOKEN_SIGNING_SECRET` | Yes | HMAC-SHA256 signing key (min 32 hex chars) | Generate with `openssl rand -hex 32` |
| `TOKEN_TTL_SECONDS` | No | Token lifetime in seconds (default: 900) | `900` |

### Unchanged (Server)

- `WAGTAIL_API_URL` - Wagtail API base URL
- `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_NAME` - Airtable config
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` - Redis config (still used for feedback data caching)

## Migration and Rollout

### Phase 1: Deploy Server Changes (Backward-Compatible)

1. Add `packages/server/lib/token.ts` and `packages/server/api/auth/token.ts`
2. Update `feedback.ts` and `link-check.ts` to accept BOTH `Authorization: Bearer` and `X-Wagtail-Session`
3. Check for bearer token first; fall back to legacy session validation
4. Set `TOKEN_SIGNING_SECRET` in Vercel environment variables
5. Deploy server

This allows existing extension versions to continue working.

### Phase 2: Deploy Extension Changes

1. Add `packages/extension/src/api/auth.ts`
2. Update `airtable-client.ts` and `link-check-client.ts` to use token flow
3. Build and distribute updated extension

### Phase 3: Remove Legacy Support

After confirming all users have updated:

1. Remove `X-Wagtail-Session` handling from `feedback.ts` and `link-check.ts`
2. Remove session validation Redis caching (`session:*` keys)
3. Remove `X-Wagtail-Session` from CORS `Access-Control-Allow-Headers`
4. Deploy server

## Files Changed

### New Files
- `packages/shared/src/types/auth.ts` - Token exchange type definitions
- `packages/server/lib/token.ts` - Token creation and verification
- `packages/server/api/auth/token.ts` - Token exchange endpoint
- `packages/extension/src/api/auth.ts` - Extension auth module

### Modified Files
- `packages/shared/src/types/index.ts` - Export auth types
- `packages/server/lib/auth.ts` - Add `extractBearerToken` helper
- `packages/server/api/feedback.ts` - Replace session auth with token auth
- `packages/server/api/link-check.ts` - Replace session auth with token auth
- `packages/extension/src/api/airtable-client.ts` - Use token auth with retry
- `packages/extension/src/api/link-check-client.ts` - Use token auth with retry

### No Changes
- `packages/extension/src/api/wagtail-client.ts` - Direct Wagtail calls still use cookies
- `packages/extension/manifest.config.ts` - Permissions unchanged
- `packages/extension/src/sidepanel/` - No UI changes needed
- `packages/extension/src/background/service-worker.ts` - No changes
