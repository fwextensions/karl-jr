import { createHash, createHmac, timingSafeEqual } from "crypto";

/**
 * Token payload structure containing session fingerprint and timestamps.
 */
export interface TokenPayload {
	/** session fingerprint: SHA-256(sessionId) */
	sfp: string;
	/** issued-at: unix timestamp in seconds */
	iat: number;
	/** expires-at: unix timestamp in seconds */
	exp: number;
}

/**
 * Result of token creation containing the signed token and expiration date.
 */
export interface CreateTokenResult {
	/** the signed companion API token */
	token: string;
	/** expiration date */
	expiresAt: Date;
}

/**
 * Creates a signed token for the given session ID.
 * 
 * The token contains a SHA-256 hash of the session ID (not the raw session ID),
 * issued-at and expiration timestamps, and is signed with HMAC-SHA256.
 * 
 * Token format: base64url(payload).base64url(hmac)
 * 
 * @param sessionId - The Wagtail session ID to create a token for
 * @param secret - The HMAC signing secret
 * @param ttlSeconds - Token lifetime in seconds (default: 900 = 15 minutes)
 * @returns Object containing the signed token and expiration date
 */
export function createToken(
	sessionId: string,
	secret: string,
	ttlSeconds: number = 900
): CreateTokenResult {
	// compute SHA-256 session fingerprint
	const sfp = createHash("sha256")
		.update(sessionId)
		.digest("hex");

	// build payload with timestamps
	const now = Math.floor(Date.now() / 1000);
	const payload: TokenPayload = {
		sfp,
		iat: now,
		exp: now + ttlSeconds,
	};

	// encode payload as base64url
	const payloadJson = JSON.stringify(payload);
	const payloadBase64url = Buffer.from(payloadJson).toString("base64url");

	// sign with HMAC-SHA256
	const hmac = createHmac("sha256", secret)
		.update(payloadBase64url)
		.digest("base64url");

	// combine as base64url(payload).base64url(hmac)
	const token = `${payloadBase64url}.${hmac}`;

	// return token and expiration date
	const expiresAt = new Date((now + ttlSeconds) * 1000);

	return { token, expiresAt };
}

/**
 * Verifies a token's signature and expiration.
 * 
 * Validates that:
 * - Token has exactly one dot separator
 * - Both parts are valid base64url strings
 * - HMAC signature matches (using timing-safe comparison)
 * - Token has not expired
 * 
 * @param token - The token string to verify
 * @param secret - The HMAC signing secret used to create the token
 * @returns The decoded payload if valid, or null if invalid/expired
 */
export function verifyToken(
	token: string,
	secret: string
): TokenPayload | null {
	// validate inputs
	if (!token || typeof token !== "string") {
		return null;
	}
	if (!secret || typeof secret !== "string") {
		return null;
	}

	// split token on dot separator
	const parts = token.split(".");
	
	// verify token has exactly one dot separator (two parts)
	if (parts.length !== 2) {
		return null;
	}

	const [payloadBase64url, receivedHmac] = parts;

	// verify both parts are non-empty
	if (!payloadBase64url || !receivedHmac) {
		return null;
	}

	// verify both parts are valid base64url (only A-Za-z0-9_-)
	const base64urlPattern = /^[A-Za-z0-9_-]+$/;
	if (!base64urlPattern.test(payloadBase64url) || !base64urlPattern.test(receivedHmac)) {
		return null;
	}

	// decode payload
	let payload: TokenPayload;
	try {
		const payloadJson = Buffer.from(payloadBase64url, "base64url").toString("utf-8");
		payload = JSON.parse(payloadJson);
	} catch {
		// invalid base64url or JSON
		return null;
	}

	// verify payload has required fields
	if (
		typeof payload.sfp !== "string" ||
		typeof payload.iat !== "number" ||
		typeof payload.exp !== "number"
	) {
		return null;
	}

	// verify HMAC signature using timing-safe comparison
	const expectedHmac = createHmac("sha256", secret)
		.update(payloadBase64url)
		.digest("base64url");

	// convert both HMACs to buffers for timing-safe comparison
	const expectedHmacBuffer = Buffer.from(expectedHmac);
	const receivedHmacBuffer = Buffer.from(receivedHmac);

	// verify buffers are same length (required for timingSafeEqual)
	if (expectedHmacBuffer.length !== receivedHmacBuffer.length) {
		return null;
	}

	// timing-safe comparison
	if (!timingSafeEqual(expectedHmacBuffer, receivedHmacBuffer)) {
		return null;
	}

	// check expiration timestamp (token is expired if current time >= exp)
	const now = Math.floor(Date.now() / 1000);
	if (now >= payload.exp) {
		return null;
	}

	// token is valid
	return payload;
}
