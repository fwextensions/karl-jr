import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { TokenResponse, TokenErrorResponse } from "@sf-gov/shared";
import { validateWagtailSession, extractWagtailSessionId, handleCors } from "../../lib/auth.js";
import { createToken } from "../../lib/token.js";

/**
 * Environment variables required for token exchange
 */
interface TokenExchangeEnv {
	WAGTAIL_API_URL: string;
	TOKEN_SIGNING_SECRET: string;
	TOKEN_TTL_SECONDS?: string;
}

/**
 * Validates required environment variables
 */
function validateEnv(): TokenExchangeEnv {
	const env = {
		WAGTAIL_API_URL: process.env.WAGTAIL_API_URL,
		TOKEN_SIGNING_SECRET: process.env.TOKEN_SIGNING_SECRET,
		TOKEN_TTL_SECONDS: process.env.TOKEN_TTL_SECONDS,
	};

	const required = ["WAGTAIL_API_URL", "TOKEN_SIGNING_SECRET"];
	const missing = required.filter(key => !env[key as keyof TokenExchangeEnv]);

	if (missing.length > 0) {
		throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
	}

	return env as TokenExchangeEnv;
}

/**
 * Token exchange endpoint: POST /api/auth/token
 * 
 * Exchanges a Wagtail session ID for a short-lived companion API token.
 * 
 * Request:
 *   - Method: POST
 *   - Header: X-Wagtail-Session: <sessionId>
 *   - Header: Origin: chrome-extension://...
 * 
 * Response (200):
 *   { "token": "...", "expiresAt": "2025-06-15T12:30:00.000Z" }
 * 
 * Error responses:
 *   - 401: Missing or invalid Wagtail session
 *   - 403: Invalid origin
 *   - 405: Method not allowed
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
	// handle CORS, preflight, method, and origin validation
	if (handleCors(req, res, "POST")) return;

	try {
		const env = validateEnv();

		// extract session ID from request headers/cookies
		const sessionId = extractWagtailSessionId(req);
		if (!sessionId) {
			return res.status(401).json({ error: "Missing session token" } as TokenErrorResponse);
		}

		// validate session against Wagtail
		const isValidSession = await validateWagtailSession(sessionId, env.WAGTAIL_API_URL);
		if (!isValidSession) {
			return res.status(401).json({ error: "Invalid or expired session" } as TokenErrorResponse);
		}

		// parse TTL from environment or use default
		const ttlSeconds = env.TOKEN_TTL_SECONDS ? parseInt(env.TOKEN_TTL_SECONDS, 10) : 900;

		// create token
		const { token, expiresAt } = createToken(sessionId, env.TOKEN_SIGNING_SECRET, ttlSeconds);

		// return token response
		const response: TokenResponse = {
			token,
			expiresAt: expiresAt.toISOString(),
		};

		return res.status(200).json(response);
	} catch (error) {
		console.error("Token exchange error:", error);
		return res.status(500).json({ error: "Internal server error" } as TokenErrorResponse);
	}
}
