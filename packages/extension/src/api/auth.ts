/**
 * Authentication Module
 * Manages token lifecycle for companion API authentication
 */

import type { TokenResponse } from "@sf-gov/shared";

/**
 * API Base URL
 * Defaults to production, can be overridden by VITE_API_BASE_URL
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://sfgov-companion-api.vercel.app";

/**
 * Token exchange endpoint URL
 */
const TOKEN_EXCHANGE_URL = `${API_BASE_URL}/api/auth/token`;

/**
 * How close to expiry (in milliseconds) before proactively refreshing
 */
const REFRESH_MARGIN = 60_000; // 60 seconds

/**
 * Default timeout for token exchange requests in milliseconds
 */
const TOKEN_EXCHANGE_TIMEOUT = 10000;

/**
 * Storage key for cached token in chrome.storage.session
 */
const STORAGE_KEY = "authToken";

/**
 * Cached token structure
 */
interface CachedToken {
	token: string;
	expiresAt: number; // unix timestamp in milliseconds
}

/**
 * In-memory cache to avoid async storage reads on every request
 */
let cachedToken: CachedToken | null = null;

/**
 * Returns a valid companion API token, performing a token exchange
 * if necessary. Throws if the user is not authenticated.
 * @returns Promise resolving to a valid bearer token string
 * @throws Error if not authenticated or token exchange fails
 */
export async function getAuthToken(): Promise<string> {
	// check in-memory cache first (fast path)
	if (cachedToken && cachedToken.expiresAt - Date.now() > REFRESH_MARGIN) {
		console.log("Using in-memory cached token");
		return cachedToken.token;
	}

	// check chrome.storage.session if not in memory
	try {
		const stored = await chrome.storage.session.get(STORAGE_KEY);
		if (stored[STORAGE_KEY]) {
			const storedToken = stored[STORAGE_KEY] as CachedToken;
			
			// check if stored token is still valid
			if (storedToken.expiresAt - Date.now() > REFRESH_MARGIN) {
				console.log("Using stored cached token");
				cachedToken = storedToken;
				return storedToken.token;
			}
		}
	} catch (error) {
		console.log("Failed to read from storage:", error);
		// continue to token exchange
	}

	// perform token exchange if not cached or near expiry
	console.log("Token not cached or near expiry, performing exchange");
	return await exchangeToken();
}

/**
 * Performs the one-time token exchange: sends the Wagtail session ID
 * to /api/auth/token and stores the returned token.
 * @returns Promise resolving to the new token string
 * @throws Error if session not found or exchange fails
 */
async function exchangeToken(): Promise<string> {
	// get Wagtail session ID from cookies
	const sessionId = await getWagtailSessionId();
	if (!sessionId) {
		throw new Error("Not authenticated. Please log in to Wagtail.");
	}

	console.log("Exchanging Wagtail session for companion token");

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), TOKEN_EXCHANGE_TIMEOUT);

		const response = await fetch(TOKEN_EXCHANGE_URL, {
			method: "POST",
			headers: {
				"X-Wagtail-Session": sessionId,
				"X-SF-Gov-Extension": "companion",
			},
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (response.status === 401) {
			throw new Error("Invalid or expired session. Please log in to Wagtail.");
		}

		if (response.status === 403) {
			throw new Error("Access denied. Invalid extension origin.");
		}

		if (response.status >= 500) {
			throw new Error(`Token exchange failed: server error (${response.status})`);
		}

		if (!response.ok) {
			throw new Error(`Token exchange failed: HTTP ${response.status}`);
		}

		const data: TokenResponse = await response.json();
		
		// parse expiration timestamp and cache the token
		const expiresAt = new Date(data.expiresAt).getTime();
		const newToken: CachedToken = {
			token: data.token,
			expiresAt,
		};

		// store in both memory and chrome.storage.session
		cachedToken = newToken;
		
		try {
			await chrome.storage.session.set({ [STORAGE_KEY]: newToken });
			console.log("Token cached successfully");
		} catch (error) {
			console.log("Failed to cache token in storage:", error);
			// continue anyway - in-memory cache is sufficient
		}

		return data.token;
	} catch (error) {
		if (error instanceof Error) {
			if (error.name === "AbortError") {
				throw new Error("Token exchange timed out. Check your connection.");
			}
			// re-throw our custom error messages
			throw error;
		}
		if (error instanceof TypeError) {
			throw new Error("Unable to connect to token exchange endpoint. Check your network connection.");
		}
		throw new Error("An unexpected error occurred during token exchange");
	}
}

/**
 * Clears the cached token. Call this on 401 responses to force
 * a fresh exchange on the next request.
 * @returns Promise that resolves when the token is cleared
 */
export async function clearAuthToken(): Promise<void> {
	console.log("Clearing cached token");
	cachedToken = null;
	
	try {
		await chrome.storage.session.remove(STORAGE_KEY);
	} catch (error) {
		console.log("Failed to clear token from storage:", error);
	}
}

/**
 * Retrieves the Wagtail session ID from browser cookies
 * @returns Promise resolving to the session ID string or null if not found
 */
async function getWagtailSessionId(): Promise<string | null> {
	try {
		// try to get cookie from api.sf.gov first (where admin is hosted)
		let cookies = await chrome.cookies.getAll({
			domain: "api.sf.gov",
			name: "sessionid",
		});

		// fallback to .sf.gov domain if not found
		if (cookies.length === 0) {
			cookies = await chrome.cookies.getAll({
				domain: ".sf.gov",
				name: "sessionid",
			});
		}

		if (cookies.length > 0) {
			console.log("Found Wagtail session cookie:", cookies[0].domain);
			return cookies[0].value;
		}

		console.log("No Wagtail session cookie found");
		return null;
	} catch (error) {
		console.log("Failed to retrieve Wagtail session cookie:", error);
		return null;
	}
}
