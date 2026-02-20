import { createHash } from "crypto";
import { SignJWT, jwtVerify, errors } from "jose";

/**
 * Token payload structure containing session fingerprint.
 * Standard JWT claims (iat, exp) are handled by jose automatically.
 */
export interface TokenPayload {
	/** session fingerprint: SHA-256(sessionId) */
	sfp: string;
	/** issued-at: unix timestamp in seconds (set by jose) */
	iat: number;
	/** expires-at: unix timestamp in seconds (set by jose) */
	exp: number;
}

/**
 * Result of token creation containing the signed JWT and expiration date.
 */
export interface CreateTokenResult {
	/** the signed JWT */
	token: string;
	/** expiration date */
	expiresAt: Date;
}

/**
 * Encodes the signing secret as a Uint8Array for jose.
 * Expects a hex-encoded string of at least 64 characters (256 bits for HS256).
 */
function secretToKey(secret: string): Uint8Array {
	return new TextEncoder().encode(secret);
}

/**
 * Creates a signed JWT for the given session ID.
 *
 * The token contains a SHA-256 hash of the session ID (not the raw session ID),
 * issued-at and expiration timestamps, and is signed with HS256.
 *
 * @param sessionId - The Wagtail session ID to create a token for
 * @param secret - The HMAC signing secret
 * @param ttlSeconds - Token lifetime in seconds (default: 900 = 15 minutes)
 * @returns Object containing the signed JWT and expiration date
 */
export async function createToken(
	sessionId: string,
	secret: string,
	ttlSeconds: number = 900
): Promise<CreateTokenResult> {
	// compute SHA-256 session fingerprint
	const sfp = createHash("sha256")
		.update(sessionId)
		.digest("hex");

	const now = Math.floor(Date.now() / 1000);
	const expiresAt = new Date((now + ttlSeconds) * 1000);

	const token = await new SignJWT({ sfp })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt(now)
		.setExpirationTime(expiresAt)
		.sign(secretToKey(secret));

	return { token, expiresAt };
}

/**
 * Verifies a JWT's signature and expiration.
 *
 * @param token - The JWT string to verify
 * @param secret - The HMAC signing secret used to create the token
 * @returns The decoded payload if valid, or null if invalid/expired
 */
export async function verifyToken(
	token: string,
	secret: string
): Promise<TokenPayload | null> {
	if (!token || typeof token !== "string") return null;
	if (!secret || typeof secret !== "string") return null;

	try {
		const { payload } = await jwtVerify(token, secretToKey(secret), {
			algorithms: ["HS256"],
		});

		// validate our custom claim exists
		if (typeof payload.sfp !== "string") return null;

		return {
			sfp: payload.sfp as string,
			iat: payload.iat!,
			exp: payload.exp!,
		};
	} catch (err) {
		// jose throws specific error types for expired, invalid signature, etc.
		if (err instanceof errors.JWTExpired) {
			return null;
		}
		return null;
	}
}
