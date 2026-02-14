# Token Exchange Authentication Design

## Motivation

The current authentication flow sends the raw Wagtail `sessionid` cookie from the extension to the Vercel server on every request via the `X-Wagtail-Session` header. This has several security concerns:

1. **Full credential in transit on every request.** The session ID is a complete Wagtail credential. If intercepted (Vercel logs, debugging tools, compromised middleware), it grants full admin access to Wagtail.
2. **Raw session ID stored in Redis.** The cache key `session:${sessionId}` stores the credential in plaintext. A leak of the Upstash Redis token exposes every recently-active session.
3. **Session ID logged in server output.** The first 8 characters are logged on every request, leaking ~25% of a 32-character hex session's entropy.
4. **No scope limitation.** If the token sent to the server is stolen, the attacker gets full Wagtail admin access, not just feedback read access.

## Solution Overview

Replace the per-request session ID forwarding with a one-time token exchange:

1. Extension sends the Wagtail session ID **once** to a new `/api/auth/token` endpoint.
2. Server validates the session against Wagtail (same as today), then issues a short-lived, HMAC-signed token scoped to the companion API.
3. Extension stores the token in `chrome.storage.session` and uses it for all subsequent requests via `Authorization: Bearer <token>`.
4. Server validates the token by verifying the HMAC signature locally -- no Redis lookup, no Wagtail roundtrip.
5. On 401, extension re-does the exchange (transparent to the user).

### Security Properties

| Property | Current | Proposed |
|---|---|---|
| Credential sent per request | Raw Wagtail session ID | Server-issued scoped token |
| Blast radius if token leaks | Full Wagtail admin access | Read-only companion API for <= 15 min |
| Blast radius if Redis leaks | All recent Wagtail sessions | Nothing (tokens are self-validating) |
| Wagtail roundtrips | Every cache miss (~10% of requests) | Only during token exchange |
| Sensitive data in logs | First 8 chars of session ID | Token prefix (not a Wagtail credential) |

---

## Architecture

### System Flow (After)

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

The token is a base64url-encoded JSON payload with an appended HMAC-SHA256 signature. No need for a full JWT library -- the token structure is simple and internal.

```
base64url(payload) + "." + base64url(hmac)
```

**Payload:**

```typescript
interface TokenPayload {
	// session fingerprint: SHA-256(sessionId), NOT the session itself
	sfp: string;
	// issued-at: unix timestamp in seconds
	iat: number;
	// expires-at: unix timestamp in seconds
	exp: number;
}
```

The `sfp` (session fingerprint) field stores a SHA-256 hash of the Wagtail session ID.  This allows the server to associate the token with a session (for logging, revocation) without storing the raw credential.  The token itself never contains the session ID.

**Signing:**

```typescript
HMAC-SHA256(base64url(payload), TOKEN_SIGNING_SECRET)
```

Where `TOKEN_SIGNING_SECRET` is a new Vercel environment variable (minimum 32 bytes of entropy, generated via `openssl rand -hex 32`).

### Token Lifetime

- **Default TTL: 15 minutes** (900 seconds).  Configurable via `TOKEN_TTL_SECONDS` env var.
- The extension refreshes the token when it receives a 401, or proactively when it's within 60 seconds of expiry.
- No refresh tokens -- the extension always has the Wagtail session cookie available for a fresh exchange.

---

## Detailed Changes by Component

### 1. New shared types (`packages/shared/src/types/auth.ts`)

Add a new types file for the token exchange API contract.

```typescript
/**
 * Request body for POST /api/auth/token
 * (no body -- session ID comes from the X-Wagtail-Session header)
 */

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

### 2. New server module: `packages/server/lib/token.ts`

This module handles token creation and verification using Node's built-in `crypto` module.  No external dependencies.

**Exports:**

```typescript
/**
 * Creates a signed token for the given session fingerprint.
 * @param sessionId - the raw Wagtail session ID (hashed internally)
 * @param secret - the HMAC signing secret
 * @param ttlSeconds - token lifetime (default 900)
 * @returns { token: string; expiresAt: Date }
 */
export function createToken(
	sessionId: string,
	secret: string,
	ttlSeconds?: number
): { token: string; expiresAt: Date };

/**
 * Verifies a token's signature and expiration.
 * @param token - the token string from the Authorization header
 * @param secret - the HMAC signing secret
 * @returns the decoded payload if valid, or null if invalid/expired
 */
export function verifyToken(
	token: string,
	secret: string
): TokenPayload | null;
```

**Implementation notes:**

- `createToken` computes `sfp = SHA-256(sessionId)` using `crypto.createHash("sha256")`, builds the payload, signs with `crypto.createHmac("sha256", secret)`, and concatenates as `base64url(payload).base64url(hmac)`.
- `verifyToken` splits on `.`, recomputes the HMAC over the payload portion, does a timing-safe comparison (`crypto.timingSafeEqual`), then checks `exp > now`.
- Uses `Buffer.from(str, "base64url")` for encoding/decoding (available in Node 16+, which Vercel uses).

### 3. New server endpoint: `packages/server/api/auth/token.ts`

A new Vercel serverless function at `POST /api/auth/token`.

**Request:**
- Method: `POST`
- Header: `X-Wagtail-Session: <sessionId>` (one-time use)
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
- `405`: Method not allowed (non-POST)

**Implementation outline:**

```typescript
import { validateWagtailSession } from "../../lib/auth.js";
import { createToken } from "../../lib/token.js";

export default async function handler(req, res) {
	// 1. CORS / origin validation (same as existing endpoints)
	// 2. Method check (POST only)
	// 3. Extract session ID from X-Wagtail-Session header
	// 4. Validate against Wagtail (using existing validateWagtailSession)
	// 5. If valid, create token and return { token, expiresAt }
	// 6. If invalid, return 401
}
```

**Environment variables required:**
- `TOKEN_SIGNING_SECRET` (new, required) -- HMAC key, min 32 hex chars
- `WAGTAIL_API_URL` (existing)

**No Redis interaction.**  The token is self-validating via its HMAC signature.  Session validation happens once at exchange time -- no need to cache.

### 4. Changes to `packages/server/lib/auth.ts`

Add a new helper to extract and verify a bearer token from a request:

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

The existing `validateWagtailSession` function is unchanged -- it's still used by the token exchange endpoint.

### 5. Changes to `packages/server/api/feedback.ts`

Replace session-based auth with token-based auth.

**Before (lines 249-289):**
```typescript
const sessionId = req.headers["x-wagtail-session"] as string | undefined;
if (!sessionId) {
	return res.status(401).json({ error: "Missing session token" });
}
// ... Redis cache lookup for session validation ...
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

**Other changes to feedback.ts:**
- Remove the `SESSION_CACHE_TTL` constant (no longer needed).
- Remove the `sessionCacheKey` variable and the Redis session cache lookup/write (lines 261-284).  Feedback data caching in Redis is unchanged.
- Remove `import { validateWagtailSession }` (no longer called from this endpoint).
- Add `import { extractBearerToken } from "../lib/auth.js"` and `import { verifyToken } from "../lib/token.js"`.
- Add `TOKEN_SIGNING_SECRET` to the `ProxyEnv` interface and `validateEnv()` required list.
- Update CORS `Access-Control-Allow-Headers` to include `Authorization` (and keep `X-SF-Gov-Extension`; remove `X-Wagtail-Session`).
- Update log statements to use `tokenPayload.sfp.substring(0, 8)` instead of `sessionId.substring(0, 8)` for traceability without credential exposure.

### 6. Changes to `packages/server/api/link-check.ts`

Same pattern as feedback.ts:

- Replace `extractWagtailSessionId(req)` + `validateWagtailSession()` with `extractBearerToken(req)` + `verifyToken()`.
- Remove the `extractWagtailSessionId` function entirely (lines 728-751).
- Add `TOKEN_SIGNING_SECRET` to the env validation.
- Update CORS headers.
- Update auth failure logging to use session fingerprint from token payload.

### 7. New extension module: `packages/extension/src/api/auth.ts`

Centralized auth module that manages the token lifecycle.  This replaces the duplicated `getWagtailSessionId()` calls scattered across `airtable-client.ts` and `link-check-client.ts`.

```typescript
/**
 * Auth module for managing companion API tokens.
 *
 * Handles token exchange, caching in chrome.storage.session,
 * and transparent refresh on expiry.
 */

// how close to expiry (in ms) before proactively refreshing
const REFRESH_MARGIN = 60_000;

// in-memory cache to avoid async storage reads on every request
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Returns a valid companion API token, performing a token exchange
 * if necessary.  Throws if the user is not authenticated (no session cookie).
 */
export async function getAuthToken(): Promise<string> {
	// 1. Check in-memory cache
	if (cachedToken && cachedToken.expiresAt - Date.now() > REFRESH_MARGIN) {
		return cachedToken.token;
	}

	// 2. Check chrome.storage.session
	const stored = await chrome.storage.session.get("authToken");
	if (stored.authToken) {
		const { token, expiresAt } = stored.authToken;
		if (expiresAt - Date.now() > REFRESH_MARGIN) {
			cachedToken = { token, expiresAt };
			return token;
		}
	}

	// 3. Perform token exchange
	return await exchangeToken();
}

/**
 * Performs the one-time token exchange: sends the Wagtail session ID
 * to /api/auth/token and stores the returned token.
 */
async function exchangeToken(): Promise<string> {
	const sessionId = await getWagtailSessionId();
	if (!sessionId) {
		throw new AuthError("Not authenticated. Please log in to Wagtail.");
	}

	const response = await fetch(`${API_BASE_URL}/api/auth/token`, {
		method: "POST",
		headers: {
			"X-Wagtail-Session": sessionId,
			"X-SF-Gov-Extension": "companion",
		},
	});

	if (response.status === 401) {
		throw new AuthError("Invalid or expired session. Please log in to Wagtail.");
	}
	if (!response.ok) {
		throw new AuthError(`Token exchange failed: ${response.status}`);
	}

	const { token, expiresAt }: TokenResponse = await response.json();
	const expiresAtMs = new Date(expiresAt).getTime();

	// cache in chrome.storage.session (survives service worker restarts,
	// clears when browser closes)
	await chrome.storage.session.set({
		authToken: { token, expiresAt: expiresAtMs },
	});

	// also cache in memory for fast access
	cachedToken = { token, expiresAt: expiresAtMs };

	return token;
}

/**
 * Clears the cached token.  Call this on 401 responses to force
 * a fresh exchange on the next request.
 */
export async function clearAuthToken(): Promise<void> {
	cachedToken = null;
	await chrome.storage.session.remove("authToken");
}

/**
 * Reads the Wagtail session ID from browser cookies.
 * This is the existing logic, moved here as a private helper.
 */
async function getWagtailSessionId(): Promise<string | null> {
	// ... existing implementation from airtable-client.ts:83-110 ...
}
```

`AuthError` is a simple custom error class in this module (or use the existing `createApiError` pattern).

### 8. Changes to `packages/extension/src/api/airtable-client.ts`

- Remove `getWagtailSessionId()` (moved to `auth.ts`).  If it's exported and used elsewhere, re-export from `auth.ts`.
- Replace session-based auth with token-based auth, including a retry-on-401 pattern:

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

		// ... rest of existing response handling unchanged ...
	}
}
```

### 9. Changes to `packages/extension/src/api/link-check-client.ts`

Same pattern as airtable-client:

- Remove the private `getWagtailSessionId()` method.
- Import `getAuthToken` and `clearAuthToken` from `./auth.js`.
- In `startCheck()`, replace:
  ```typescript
  "X-Wagtail-Session": sessionId,
  ```
  with:
  ```typescript
  "Authorization": `Bearer ${token}`,
  ```
- Add retry-on-401 logic (attempt exchange, retry request once).

### 10. Changes to `packages/extension/src/api/wagtail-client.ts`

The `getCurrentUser()` function at line 516 reads cookies directly to call the Wagtail userbar API.  This is a **direct Wagtail call**, not a call to the companion server, so it does NOT use the new token.  No changes needed here.

However, the `getWagtailSessionId()` helper used by `getCurrentUser` should be imported from `auth.ts` rather than duplicated.  Move the function but keep the export for this use case.

### 11. Manifest permissions

No changes needed.  The extension already has:
- `"cookies"` permission (still needed for token exchange)
- `"storage"` permission (already present, covers `chrome.storage.session`)
- Host permissions for `*.sf.gov` (unchanged)

---

## Environment Variables

### New (server)

| Variable | Required | Description |
|---|---|---|
| `TOKEN_SIGNING_SECRET` | Yes | HMAC-SHA256 signing key. Generate with `openssl rand -hex 32`. Min 32 hex chars. |
| `TOKEN_TTL_SECONDS` | No | Token lifetime in seconds. Default: `900` (15 minutes). |

### Unchanged (server)

- `WAGTAIL_API_URL`
- `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_NAME`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (still used for feedback data caching)

---

## Migration and Rollout

### Phase 1: Deploy server changes (backward-compatible)

1. Add `packages/server/lib/token.ts` and `packages/server/api/auth/token.ts`.
2. Update `feedback.ts` and `link-check.ts` to accept **both** `Authorization: Bearer` and `X-Wagtail-Session` during the transition.  Check for bearer token first; fall back to legacy session validation.
3. Set `TOKEN_SIGNING_SECRET` in Vercel environment variables.
4. Deploy server.

This allows existing extension versions to keep working.

### Phase 2: Deploy extension changes

1. Add `packages/extension/src/api/auth.ts`.
2. Update `airtable-client.ts` and `link-check-client.ts` to use the new token flow.
3. Build and distribute the updated extension.

### Phase 3: Remove legacy support

After confirming all users have updated:

1. Remove `X-Wagtail-Session` handling from `feedback.ts` and `link-check.ts`.
2. Remove session validation Redis caching (`session:*` keys).
3. Remove `X-Wagtail-Session` from CORS `Access-Control-Allow-Headers`.
4. Deploy server.

---

## Error Handling

### Token exchange failures

| Scenario | Extension behavior |
|---|---|
| No session cookie | Show "Please log in to Wagtail" (same as today) |
| Session expired (401 from exchange) | Show "Session expired" with login link |
| Server error (500 from exchange) | Show "Unable to connect" with retry option |
| Network error | Show "Check your connection" (same as today) |

### Token validation failures

| Scenario | Server behavior | Extension behavior |
|---|---|---|
| Missing Authorization header | 401 | Clear token, retry exchange once |
| Malformed token | 401 | Clear token, retry exchange once |
| Expired token | 401 | Clear token, retry exchange once |
| Invalid signature | 401 | Clear token, retry exchange once |
| Token valid | Proceed normally | N/A |

The extension's retry-on-401 loop (max 1 retry) ensures transparent recovery when a token expires mid-session.  If the retry also fails (e.g., Wagtail session expired), the user sees the auth error.

---

## Testing

### Server unit tests

1. **`lib/token.ts` -- createToken**
   - Creates a token with correct payload structure
   - Token contains SHA-256 fingerprint, not raw session ID
   - Respects custom TTL
   - Different sessions produce different tokens

2. **`lib/token.ts` -- verifyToken**
   - Accepts a valid, unexpired token
   - Rejects an expired token
   - Rejects a token with a tampered payload
   - Rejects a token with a tampered signature
   - Rejects a token signed with a different secret
   - Rejects malformed input (empty string, no dot separator, non-base64)
   - Uses timing-safe comparison (verify via code review)

3. **`api/auth/token.ts`**
   - Returns 200 + token for a valid session
   - Returns 401 for invalid session
   - Returns 401 for missing `X-Wagtail-Session` header
   - Returns 403 for invalid origin
   - Returns 405 for GET/PUT/DELETE

4. **`api/feedback.ts` (updated)**
   - Returns 200 for valid bearer token
   - Returns 401 for missing Authorization header
   - Returns 401 for expired token
   - Feedback data caching still works

5. **`api/link-check.ts` (updated)**
   - Same auth test cases as feedback
   - SSE streaming still works after auth change

### Extension manual testing

1. Fresh install (no cached token): verify token exchange happens on first feedback/link-check request.
2. Token expiry: set short TTL (e.g., 60s), wait, verify transparent refresh.
3. Session expiry: log out of Wagtail, verify "please log in" message after retry.
4. Service worker restart: close/reopen browser, verify `chrome.storage.session` recovery works.
5. Multiple tabs: verify token is shared across side panel instances.

### Security validation

1. Verify the raw session ID does not appear in Vercel function logs.
2. Verify the raw session ID is not stored in Redis.
3. Verify a stolen token cannot be used to access Wagtail admin (it's only valid for companion API endpoints).
4. Verify token is not accepted after expiry even if signature is valid.
5. Verify CORS headers no longer advertise `X-Wagtail-Session` (after phase 3).

---

## Files Changed (Summary)

### New files
- `packages/shared/src/types/auth.ts`
- `packages/server/lib/token.ts`
- `packages/server/api/auth/token.ts`
- `packages/extension/src/api/auth.ts`

### Modified files
- `packages/shared/src/types/index.ts` -- add auth export
- `packages/server/lib/auth.ts` -- add `extractBearerToken`
- `packages/server/api/feedback.ts` -- replace session auth with token auth
- `packages/server/api/link-check.ts` -- replace session auth with token auth
- `packages/extension/src/api/airtable-client.ts` -- use `getAuthToken`, remove `getWagtailSessionId`
- `packages/extension/src/api/link-check-client.ts` -- use `getAuthToken`, remove `getWagtailSessionId`

### No changes
- `packages/extension/src/api/wagtail-client.ts` -- direct Wagtail calls still use cookies
- `packages/extension/manifest.config.ts` -- permissions unchanged
- `packages/extension/src/sidepanel/` -- no UI changes needed
- `packages/extension/src/background/service-worker.ts` -- no changes
