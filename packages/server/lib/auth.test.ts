import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import type { VercelRequest } from "@vercel/node";
import { extractBearerToken } from "./auth.js";

/**
 * Creates a mock VercelRequest with the specified Authorization header
 */
function createMockRequest(authHeader?: string): VercelRequest {
	return {
		headers: {
			authorization: authHeader,
		},
	} as VercelRequest;
}

describe("extractBearerToken", () => {
	test("extracts token from valid Bearer authorization header", () => {
		const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature";
		const req = createMockRequest(`Bearer ${token}`);

		const result = extractBearerToken(req);

		assert.equal(result, token, "Should extract token from Bearer header");
	});

	test("returns null when Authorization header is missing", () => {
		const req = createMockRequest(undefined);

		const result = extractBearerToken(req);

		assert.equal(result, null, "Should return null when Authorization header is missing");
	});

	test("returns null when Authorization header does not start with 'Bearer '", () => {
		const req = createMockRequest("Basic dXNlcjpwYXNz");

		const result = extractBearerToken(req);

		assert.equal(result, null, "Should return null for non-Bearer authorization");
	});

	test("returns null when Authorization header is 'Bearer' without space", () => {
		const req = createMockRequest("Bearertoken123");

		const result = extractBearerToken(req);

		assert.equal(result, null, "Should return null when 'Bearer' is not followed by space");
	});

	test("returns null when Authorization header is only 'Bearer '", () => {
		const req = createMockRequest("Bearer ");

		const result = extractBearerToken(req);

		assert.equal(result, "", "Should return empty string when token part is empty");
	});

	test("extracts token with special characters", () => {
		const token = "abc-123_xyz.def-456_uvw";
		const req = createMockRequest(`Bearer ${token}`);

		const result = extractBearerToken(req);

		assert.equal(result, token, "Should extract token with special characters");
	});

	test("extracts very long token", () => {
		const token = "a".repeat(1000);
		const req = createMockRequest(`Bearer ${token}`);

		const result = extractBearerToken(req);

		assert.equal(result, token, "Should extract very long token");
	});

	test("returns null for lowercase 'bearer'", () => {
		const req = createMockRequest("bearer token123");

		const result = extractBearerToken(req);

		assert.equal(result, null, "Should return null for lowercase 'bearer'");
	});

	test("returns null for 'BEARER' in all caps", () => {
		const req = createMockRequest("BEARER token123");

		const result = extractBearerToken(req);

		assert.equal(result, null, "Should return null for 'BEARER' in all caps");
	});

	test("extracts token with spaces in the token value", () => {
		const token = "token with spaces";
		const req = createMockRequest(`Bearer ${token}`);

		const result = extractBearerToken(req);

		assert.equal(result, token, "Should extract token even if it contains spaces");
	});

	test("returns null for empty string Authorization header", () => {
		const req = createMockRequest("");

		const result = extractBearerToken(req);

		assert.equal(result, null, "Should return null for empty string");
	});

	test("returns null for whitespace-only Authorization header", () => {
		const req = createMockRequest("   ");

		const result = extractBearerToken(req);

		assert.equal(result, null, "Should return null for whitespace-only header");
	});

	test("extracts token when Authorization header has extra whitespace after Bearer", () => {
		const token = "token123";
		const req = createMockRequest(`Bearer  ${token}`);

		const result = extractBearerToken(req);

		assert.equal(result, ` ${token}`, "Should extract everything after 'Bearer ' including leading space");
	});
});
