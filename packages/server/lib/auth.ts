/**
 * Authentication utilities for server-side API endpoints
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyToken } from "./token.js";
import { createHash } from "crypto";

const WAGTAIL_VALIDATION_TIMEOUT = parseInt(process.env.WAGTAIL_VALIDATION_TIMEOUT || "5000", 10);

/**
 * Validates a Wagtail session by making a request to the Wagtail API
 * @param sessionId - The Wagtail session ID from the cookie
 * @param wagtailApiUrl - The base URL of the Wagtail API
 * @returns Promise<boolean> - True if the session is valid, false otherwise
 */
export async function validateWagtailSession(sessionId: string, wagtailApiUrl: string): Promise<boolean> {
	let timeoutId: NodeJS.Timeout;
	try {
		const baseUrl = wagtailApiUrl.replace(/\/$/, "");
		const validationUrl = `${baseUrl}/pages`;

		const fetchPromise = fetch(validationUrl, {
			method: "GET",
			headers: {
				"Cookie": `sessionid=${sessionId}`,
				"User-Agent": "SF-Gov-Companion-Extension/1.0",
				"X-SF-Gov-Extension": "companion",
			},
			redirect: "manual",
		});

		const timeoutPromise = new Promise<Response>((_, reject) => {
			timeoutId = setTimeout(() => reject(new Error("Request timed out")), WAGTAIL_VALIDATION_TIMEOUT);
		});

		const response = await Promise.race([fetchPromise, timeoutPromise]);
		clearTimeout(timeoutId!);

		return response.ok || (response.status >= 300 && response.status < 400);
	} catch (error) {
		console.error("Wagtail session validation failed:", error);
		return false;
	} finally {
		// @ts-ignore
		if (typeof timeoutId !== "undefined") clearTimeout(timeoutId);
	}
}

/**
 * Extracts the bearer token from the Authorization header.
 * Returns null if the header is missing or malformed.
 * 
 * @param req - The Vercel request object
 * @returns The bearer token string, or null if missing/malformed
 * 
 * @example
 * const token = extractBearerToken(req);
 * if (!token) {
 *   return res.status(401).json({ error: "Missing or invalid authorization" });
 * }
 */
export function extractBearerToken(req: VercelRequest): string | null {
	const header = req.headers.authorization;
	if (!header || !header.startsWith("Bearer ")) return null;
	return header.slice(7);
}

/**
 * Validates that the request origin is from a browser extension or local dev.
 */
export function validateOrigin(origin: string | undefined): boolean {
	if (!origin) return false;
	if (origin.startsWith("chrome-extension://") || origin.startsWith("edge-extension://")) {
		return true;
	}
	if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
		return true;
	}
	return false;
}

/**
 * Extracts the Wagtail session ID from request headers or cookies.
 * Checks the X-Wagtail-Session header first, then falls back to the
 * sessionid cookie.
 *
 * @deprecated Will be removed when legacy session auth is retired
 */
export function extractWagtailSessionId(req: VercelRequest): string | null {
	// check for X-Wagtail-Session header first (sent by extension)
	const sessionHeader = req.headers["x-wagtail-session"] as string | undefined;
	if (sessionHeader) {
		return sessionHeader;
	}

	// fallback to cookie header
	const cookieHeader = req.headers.cookie;
	if (!cookieHeader) {
		return null;
	}

	// parse cookies to find sessionid
	const cookies = cookieHeader.split(";").map(c => c.trim());
	for (const cookie of cookies) {
		const [name, value] = cookie.split("=");
		if (name === "sessionid" && value) {
			return value;
		}
	}

	return null;
}

/**
 * Result of a successful authentication attempt.
 */
export interface AuthResult {
	ok: true;
	/** SHA-256 fingerprint of the session, for logging */
	sessionFingerprint: string;
}

/**
 * Result of a failed authentication attempt.
 */
export interface AuthFailure {
	ok: false;
	status: number;
	error: string;
}

/**
 * Authenticates a request using token-based auth (preferred) with fallback
 * to legacy Wagtail session validation.
 *
 * The legacy session path will be removed once all clients use token auth.
 *
 * @param req - The incoming request
 * @param tokenSigningSecret - Secret used to verify bearer tokens
 * @param wagtailApiUrl - Wagtail API base URL for legacy session validation
 */
export async function authenticateRequest(
	req: VercelRequest,
	tokenSigningSecret: string,
	wagtailApiUrl: string
): Promise<AuthResult | AuthFailure> {
	// try token-based authentication first
	const bearerToken = extractBearerToken(req);

	if (bearerToken) {
		const tokenPayload = verifyToken(bearerToken, tokenSigningSecret);
		if (!tokenPayload) {
			return { ok: false, status: 401, error: "Invalid or expired token" };
		}
		return { ok: true, sessionFingerprint: tokenPayload.sfp };
	}

	// fall back to legacy session-based authentication
	const sessionId = extractWagtailSessionId(req);
	if (!sessionId) {
		return { ok: false, status: 401, error: "Missing authentication" };
	}

	const isValidSession = await validateWagtailSession(sessionId, wagtailApiUrl);
	if (!isValidSession) {
		return { ok: false, status: 401, error: "Invalid Wagtail session" };
	}

	const sessionFingerprint = createHash("sha256").update(sessionId).digest("hex");
	return { ok: true, sessionFingerprint };
}

/**
 * Handles CORS preflight and origin validation boilerplate.
 *
 * @returns `true` if the response has been sent (preflight handled, or
 *   origin/method rejected) and the caller should return immediately.
 *   `false` if the request should continue to the handler logic.
 */
export function handleCors(
	req: VercelRequest,
	res: VercelResponse,
	allowedMethod: string
): boolean {
	const origin = req.headers.origin as string | undefined;
	const isValidOrigin = validateOrigin(origin);

	if (isValidOrigin && origin) {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Access-Control-Allow-Methods", `${allowedMethod}, OPTIONS`);
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Wagtail-Session, X-SF-Gov-Extension");
		res.setHeader("Access-Control-Max-Age", "86400");
	}

	// handle preflight OPTIONS request
	if (req.method === "OPTIONS") {
		if (isValidOrigin) {
			res.status(200).end();
		} else {
			res.status(403).json({ error: "Invalid origin" });
		}
		return true;
	}

	// reject wrong HTTP method
	if (req.method !== allowedMethod) {
		res.status(405).json({ error: "Method not allowed" });
		return true;
	}

	// reject invalid origin
	if (!isValidOrigin) {
		res.status(403).json({ error: "Invalid origin" });
		return true;
	}

	return false;
}
