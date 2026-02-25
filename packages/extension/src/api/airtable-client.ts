/**
 * Airtable API Client
 * Handles communication with the Airtable proxy API for user feedback data
 */

import type { FeedbackResponse, AirtableApiError } from "@sf-gov/shared";
import { getAuthToken, clearAuthToken } from "./auth";

/**
 * API proxy endpoint URL
 */
/**
 * API Base URL
 * Defaults to production, can be overridden by VITE_API_BASE_URL
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://sfgov-companion-api.vercel.app";

/**
 * API endpoint URLs
 */
const API_FEEDBACK_URL = `${API_BASE_URL}/api/feedback`;

/**
 * Default timeout for API requests in milliseconds
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Cache TTL in milliseconds (5 minutes)
 */
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Cache entry structure
 */
interface FeedbackCacheEntry {
	data: FeedbackResponse;
	timestamp: number;
}

/**
 * In-memory cache for feedback data
 */
const feedbackCache = new Map<string, FeedbackCacheEntry>();

/**
 * Fetches a URL with a timeout using AbortController
 * @param url - The URL to fetch
 * @param options - Fetch options
 * @param timeout - Timeout in milliseconds (default: 10000)
 * @returns Promise resolving to the Response
 * @throws Error if the request times out or fails
 */
async function fetchWithTimeout(
	url: string,
	options: RequestInit,
	timeout: number = DEFAULT_TIMEOUT
): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
		});
		clearTimeout(timeoutId);
		return response;
	} catch (error) {
		clearTimeout(timeoutId);

		if (error instanceof Error && error.name === "AbortError") {
			throw new Error("Request timed out");
		}

		throw error;
	}
}

/**
 * Normalizes a page path for consistent matching
 * - Removes query parameters
 * - Removes trailing slashes (except for homepage)
 * - Converts to lowercase
 * @param path - The path to normalize
 * @returns Normalized path string
 */
export function normalizePath(path: string): string {
	// Remove query parameters
	const pathWithoutQuery = path.split("?")[0];

	// Convert to lowercase
	let normalized = pathWithoutQuery.toLowerCase();

	// Remove trailing slash, but keep "/" for homepage
	if (normalized !== "/" && normalized.endsWith("/")) {
		normalized = normalized.slice(0, -1);
	}

	return normalized;
}

/**
 * Fetches feedback data (stats + recent records) for a given page path
 * @param path - The page path to fetch feedback for
 * @returns Promise resolving to FeedbackResponse with stats and records
 * @throws AirtableApiError for authentication, network, or server errors
 */
export async function getFeedback(path: string): Promise<FeedbackResponse> {
	const normalizedPath = normalizePath(path);
	const cacheKey = `feedback:${normalizedPath}`;

	// check cache first
	const cached = feedbackCache.get(cacheKey);
	console.log("getFeedback:", { path, normalizedPath, cacheKey, hasCached: !!cached, cacheAge: cached ? Date.now() - cached.timestamp : null, cacheTTL: CACHE_TTL });
	if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
		console.log("Returning cached feedback for:", normalizedPath);
		return cached.data;
	}

	const url = new URL(API_FEEDBACK_URL);
	url.searchParams.set("pagePath", normalizedPath);

	console.log("Fetching feedback from:", url.toString());
	const fetchStart = Date.now();

	// attempt with current token, retry once on 401
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const token = await getAuthToken();

			const response = await fetchWithTimeout(
				url.toString(),
				{
					headers: {
						"Authorization": `Bearer ${token}`,
						"X-SF-Gov-Extension": "companion",
					},
				}
			);

			if (response.status === 401 && attempt === 0) {
				// token expired or revoked -- clear and retry
				console.log("Received 401, clearing token and retrying");
				await clearAuthToken();
				continue;
			}

			if (response.status === 401) {
				throw createApiError("auth", "Invalid or expired session.", response.status);
			}
			if (response.status === 403) {
				throw createApiError("auth", "Access denied. Please check your permissions.", response.status);
			}
			if (response.status === 429) {
				throw createApiError("rate_limit", "Too many requests. Please wait a moment and try again.", response.status);
			}
			if (response.status >= 500) {
				throw createApiError("server_error", "Server error. Please try again later.", response.status);
			}
			if (!response.ok) {
				throw createApiError("network", `HTTP error ${response.status}`, response.status);
			}

			console.log(`Feedback fetch completed in ${Date.now() - fetchStart}ms, status: ${response.status}`);
			const data: FeedbackResponse = await response.json();

			// cache the results
			feedbackCache.set(cacheKey, {
				data,
				timestamp: Date.now(),
			});

			return data;
		} catch (error) {
			// if this is the retry attempt, or not a 401 error, throw
			if (attempt === 1 || !isAirtableApiError(error) || error.type !== "auth") {
				if (isAirtableApiError(error)) {
					throw error;
				}
				if (error instanceof Error && error.message === "Request timed out") {
					throw createApiError("timeout", "Request timed out. Please try again.");
				}
				if (error instanceof TypeError) {
					throw createApiError("network", "Unable to connect to API. Check your network connection.");
				}
				if (error instanceof Error && (
					error.message.includes("Not authenticated") ||
					error.message.includes("Invalid or expired session") ||
					error.message.includes("Access denied")
				)) {
					throw createApiError("auth", error.message);
				}
				throw createApiError("network", "An unexpected error occurred");
			}
		}
	}

	// should never reach here, but TypeScript needs this
	throw createApiError("network", "An unexpected error occurred");
}

/**
 * Creates an AirtableApiError object with the specified properties
 * @param type - The error type
 * @param message - The error message
 * @param statusCode - Optional HTTP status code
 * @returns AirtableApiError object
 */
function createApiError(
	type: "auth" | "network" | "timeout" | "rate_limit" | "server_error",
	message: string,
	statusCode?: number
): AirtableApiError {
	return {
		type,
		message,
		statusCode,
		retryable: type !== "auth", // All errors except auth are retryable
	};
}

/**
 * Type guard to check if an error is an AirtableApiError
 * @param error - The error to check
 * @returns True if the error is an AirtableApiError
 */
function isAirtableApiError(error: any): error is AirtableApiError {
	return (
		error &&
		typeof error === "object" &&
		"type" in error &&
		"message" in error &&
		"retryable" in error
	);
}

/**
 * Clears the feedback cache for a specific path or all paths
 * @param path - Optional path to clear from cache. If not provided, clears entire cache
 */
export function clearCache(path?: string): void {
	if (path) {
		const normalizedPath = normalizePath(path);
		feedbackCache.delete(`feedback:${normalizedPath}`);
	} else {
		feedbackCache.clear();
	}
}
