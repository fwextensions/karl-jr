/**
 * Authentication type definitions for token exchange flow
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
