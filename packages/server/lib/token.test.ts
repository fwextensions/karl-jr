import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import * as fc from "fast-check";
import { createToken, verifyToken } from "./token.js";

describe("Token Creation Properties", () => {
	// **Validates: Requirements 1.1, 1.5**
	test("Property 1: Token creation produces valid fingerprints", () => {
		fc.assert(
			fc.property(
				// generate arbitrary session IDs (avoid very short strings that could match JSON syntax)
				fc.string({ minLength: 8, maxLength: 256 }),
				fc.string({ minLength: 32, maxLength: 64 }), // secret
				(sessionId, secret) => {
					// create token
					const result = createToken(sessionId, secret);

					// compute expected fingerprint
					const expectedFingerprint = createHash("sha256")
						.update(sessionId)
						.digest("hex");

					// decode token payload
					const [payloadBase64url] = result.token.split(".");
					const payloadJson = Buffer.from(payloadBase64url, "base64url").toString("utf-8");
					const payload = JSON.parse(payloadJson);

					// verify fingerprint is present in payload
					assert.equal(
						payload.sfp,
						expectedFingerprint,
						"Token payload must contain SHA-256 hash of session ID"
					);

					// verify the payload contains the fingerprint, not the raw session ID
					assert.equal(
						typeof payload.sfp,
						"string",
						"Payload must have sfp field"
					);
					assert.equal(
						payload.sfp.length,
						64,
						"Session fingerprint must be 64 hex characters (SHA-256)"
					);
					assert.notEqual(
						payload.sfp,
						sessionId,
						"Session fingerprint must not be the raw session ID"
					);

					// verify the payload does not have a field containing the raw session ID
					// (check all string values in the payload)
					const payloadValues = Object.values(payload).filter(v => typeof v === "string");
					for (const value of payloadValues) {
						if (value === sessionId) {
							assert.fail("Token payload must not contain raw session ID as a value");
						}
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 1.2**
	test("Property 2: Token creation includes required timestamps", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 8, maxLength: 256 }), // sessionId
				fc.string({ minLength: 32, maxLength: 64 }), // secret
				fc.integer({ min: 1, max: 86400 }), // ttlSeconds (1 second to 1 day)
				(sessionId, secret, ttlSeconds) => {
					// capture time before token creation
					const beforeCreation = Math.floor(Date.now() / 1000);

					// create token
					const result = createToken(sessionId, secret, ttlSeconds);

					// capture time after token creation
					const afterCreation = Math.floor(Date.now() / 1000);

					// decode token payload
					const [payloadBase64url] = result.token.split(".");
					const payloadJson = Buffer.from(payloadBase64url, "base64url").toString("utf-8");
					const payload = JSON.parse(payloadJson);

					// verify iat and exp fields exist and are numbers
					assert.equal(
						typeof payload.iat,
						"number",
						"Token payload must contain iat field as a number"
					);
					assert.equal(
						typeof payload.exp,
						"number",
						"Token payload must contain exp field as a number"
					);

					// verify iat is within reasonable bounds (between before and after creation)
					assert.ok(
						payload.iat >= beforeCreation && payload.iat <= afterCreation,
						`iat (${payload.iat}) must be between ${beforeCreation} and ${afterCreation}`
					);

					// verify iat <= exp
					assert.ok(
						payload.iat <= payload.exp,
						`iat (${payload.iat}) must be <= exp (${payload.exp})`
					);

					// verify exp = iat + ttlSeconds
					assert.equal(
						payload.exp,
						payload.iat + ttlSeconds,
						`exp must equal iat + ttlSeconds (${payload.iat} + ${ttlSeconds} = ${payload.iat + ttlSeconds})`
					);
				}
			),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 1.4**
	test("Property 3: Token format is consistent", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 8, maxLength: 256 }), // sessionId
				fc.string({ minLength: 32, maxLength: 64 }), // secret
				fc.integer({ min: 1, max: 86400 }), // ttlSeconds
				(sessionId, secret, ttlSeconds) => {
					// create token
					const result = createToken(sessionId, secret, ttlSeconds);

					// verify token is a string
					assert.equal(
						typeof result.token,
						"string",
						"Token must be a string"
					);

					// verify token contains exactly one dot separator
					const parts = result.token.split(".");
					assert.equal(
						parts.length,
						2,
						"Token must contain exactly one dot separator"
					);

					const [payloadPart, signaturePart] = parts;

					// verify both parts are non-empty
					assert.ok(
						payloadPart.length > 0,
						"Payload part must not be empty"
					);
					assert.ok(
						signaturePart.length > 0,
						"Signature part must not be empty"
					);

					// verify both parts are valid base64url (no invalid characters)
					const base64urlPattern = /^[A-Za-z0-9_-]+$/;
					assert.ok(
						base64urlPattern.test(payloadPart),
						"Payload part must be valid base64url (only A-Za-z0-9_-)"
					);
					assert.ok(
						base64urlPattern.test(signaturePart),
						"Signature part must be valid base64url (only A-Za-z0-9_-)"
					);

					// verify payload can be decoded
					let decodedPayload;
					try {
						const payloadJson = Buffer.from(payloadPart, "base64url").toString("utf-8");
						decodedPayload = JSON.parse(payloadJson);
					} catch (error) {
						assert.fail(`Payload part must be decodable as base64url JSON: ${error}`);
					}

					// verify decoded payload has expected structure
					assert.ok(
						typeof decodedPayload === "object" && decodedPayload !== null,
						"Decoded payload must be an object"
					);
					assert.ok(
						"sfp" in decodedPayload,
						"Decoded payload must have sfp field"
					);
					assert.ok(
						"iat" in decodedPayload,
						"Decoded payload must have iat field"
					);
					assert.ok(
						"exp" in decodedPayload,
						"Decoded payload must have exp field"
					);
				}
			),
			{ numRuns: 100 }
		);
	});
});

describe("Token Verification Properties", () => {
	// **Validates: Requirements 2.6**
	test("Property 4: Token verification is a round-trip", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 8, maxLength: 256 }), // sessionId
				fc.string({ minLength: 32, maxLength: 64 }), // secret
				fc.integer({ min: 1, max: 86400 }), // ttlSeconds (1 second to 1 day)
				(sessionId, secret, ttlSeconds) => {
					// create token
					const result = createToken(sessionId, secret, ttlSeconds);

					// verify token with the same secret
					const verifiedPayload = verifyToken(result.token, secret);

					// verification must succeed
					assert.notEqual(
						verifiedPayload,
						null,
						"Token verification must succeed for a valid token"
					);

					// compute expected fingerprint
					const expectedFingerprint = createHash("sha256")
						.update(sessionId)
						.digest("hex");

					// verify the payload fields match what was encoded
					assert.equal(
						verifiedPayload!.sfp,
						expectedFingerprint,
						"Verified payload sfp must match the original session fingerprint"
					);

					// verify iat and exp are preserved (within reasonable bounds due to timing)
					// decode the original payload to compare
					const [payloadBase64url] = result.token.split(".");
					const payloadJson = Buffer.from(payloadBase64url, "base64url").toString("utf-8");
					const originalPayload = JSON.parse(payloadJson);

					assert.equal(
						verifiedPayload!.iat,
						originalPayload.iat,
						"Verified payload iat must match the original iat"
					);

					assert.equal(
						verifiedPayload!.exp,
						originalPayload.exp,
						"Verified payload exp must match the original exp"
					);

					// verify the relationship between iat and exp is preserved
					assert.equal(
						verifiedPayload!.exp - verifiedPayload!.iat,
						ttlSeconds,
						"Verified payload must preserve the TTL relationship"
					);
				}
			),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 2.2**
	test("Property 5: Invalid signatures are rejected", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 8, maxLength: 256 }), // sessionId
				fc.string({ minLength: 32, maxLength: 64 }), // secret
				fc.integer({ min: 1, max: 86400 }), // ttlSeconds
				(sessionId, secret, ttlSeconds) => {
					// create a valid token
					const result = createToken(sessionId, secret, ttlSeconds);
					const [payloadPart, signaturePart] = result.token.split(".");

					// tamper with the signature by flipping a character
					// ensure we have at least one character to flip
					if (signaturePart.length === 0) {
						return; // skip this case
					}

					// flip the first character of the signature
					const tamperedChar = signaturePart[0] === "A" ? "B" : "A";
					const tamperedSignature = tamperedChar + signaturePart.slice(1);
					const tamperedToken = `${payloadPart}.${tamperedSignature}`;

					// verify the tampered token is rejected
					const verifiedPayload = verifyToken(tamperedToken, secret);

					assert.equal(
						verifiedPayload,
						null,
						"Token with tampered signature must be rejected"
					);
				}
			),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 2.3**
	test("Property 6: Expired tokens are rejected", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 8, maxLength: 256 }), // sessionId
				fc.string({ minLength: 32, maxLength: 64 }), // secret
				fc.integer({ min: -86400, max: -1 }), // negative ttlSeconds (already expired)
				(sessionId, secret, ttlSeconds) => {
					// create a token with negative TTL (already expired)
					const result = createToken(sessionId, secret, ttlSeconds);

					// verify the expired token is rejected
					const verifiedPayload = verifyToken(result.token, secret);

					assert.equal(
						verifiedPayload,
						null,
						"Expired token must be rejected"
					);
				}
			),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 2.4, 2.5**
	test("Property 7: Malformed tokens are rejected", () => {
		fc.assert(
			fc.property(
				fc.oneof(
					// tokens with no dot separator
					fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.includes(".")),
					// tokens with multiple dot separators
					fc.tuple(
						fc.string({ minLength: 1, maxLength: 50 }),
						fc.string({ minLength: 1, maxLength: 50 }),
						fc.string({ minLength: 1, maxLength: 50 })
					).map(([a, b, c]) => `${a}.${b}.${c}`),
					// tokens with empty parts
					fc.constant("."),
					fc.string({ minLength: 1, maxLength: 50 }).map(s => `${s}.`),
					fc.string({ minLength: 1, maxLength: 50 }).map(s => `.${s}`),
					// tokens with invalid base64url characters
					fc.tuple(
						fc.string({ minLength: 1, maxLength: 50 }),
						fc.constantFrom("+", "/", "=", " ", "\n", "\t", "!", "@", "#")
					).map(([base, invalid]) => `${base}${invalid}.signature`),
					fc.tuple(
						fc.string({ minLength: 1, maxLength: 50 }),
						fc.constantFrom("+", "/", "=", " ", "\n", "\t", "!", "@", "#")
					).map(([base, invalid]) => `payload.${base}${invalid}`)
				),
				fc.string({ minLength: 32, maxLength: 64 }), // secret
				(malformedToken, secret) => {
					// verify the malformed token is rejected
					const verifiedPayload = verifyToken(malformedToken, secret);

					assert.equal(
						verifiedPayload,
						null,
						`Malformed token "${malformedToken}" must be rejected`
					);
				}
			),
			{ numRuns: 100 }
		);
	});
});

describe("Token Edge Cases", () => {
	const SECRET = "test-secret-key-with-sufficient-length-for-hmac";

	test("empty session ID creates valid token", () => {
		const result = createToken("", SECRET);

		assert.ok(result.token, "Token should be created for empty session ID");
		assert.ok(result.expiresAt instanceof Date, "expiresAt should be a Date");

		// verify token can be verified
		const payload = verifyToken(result.token, SECRET);
		assert.notEqual(payload, null, "Token with empty session ID should be verifiable");

		// verify fingerprint is SHA-256 of empty string
		const expectedFingerprint = createHash("sha256").update("").digest("hex");
		assert.equal(payload!.sfp, expectedFingerprint);
	});

	test("very long session ID (>1KB) creates valid token", () => {
		// create a session ID longer than 1KB
		const longSessionId = "a".repeat(2048);
		const result = createToken(longSessionId, SECRET);

		assert.ok(result.token, "Token should be created for very long session ID");

		// verify token can be verified
		const payload = verifyToken(result.token, SECRET);
		assert.notEqual(payload, null, "Token with very long session ID should be verifiable");

		// verify fingerprint is correct
		const expectedFingerprint = createHash("sha256").update(longSessionId).digest("hex");
		assert.equal(payload!.sfp, expectedFingerprint);
	});

	test("session ID with special characters creates valid token", () => {
		const specialChars = "!@#$%^&*()[]{}|\\:;\"'<>,.?/~`\n\t\r";
		const result = createToken(specialChars, SECRET);

		assert.ok(result.token, "Token should be created for session ID with special characters");

		// verify token can be verified
		const payload = verifyToken(result.token, SECRET);
		assert.notEqual(payload, null, "Token with special characters should be verifiable");

		// verify fingerprint is correct
		const expectedFingerprint = createHash("sha256").update(specialChars).digest("hex");
		assert.equal(payload!.sfp, expectedFingerprint);
	});

	test("session ID with unicode characters creates valid token", () => {
		const unicode = "你好世界🌍🚀";
		const result = createToken(unicode, SECRET);

		assert.ok(result.token, "Token should be created for session ID with unicode");

		// verify token can be verified
		const payload = verifyToken(result.token, SECRET);
		assert.notEqual(payload, null, "Token with unicode should be verifiable");

		// verify fingerprint is correct
		const expectedFingerprint = createHash("sha256").update(unicode).digest("hex");
		assert.equal(payload!.sfp, expectedFingerprint);
	});

	test("TTL of 0 seconds creates immediately expired token", () => {
		const result = createToken("test-session", SECRET, 0);

		assert.ok(result.token, "Token should be created with TTL of 0");

		// token should be expired immediately
		const payload = verifyToken(result.token, SECRET);
		assert.equal(payload, null, "Token with TTL of 0 should be immediately expired");
	});

	test("TTL of 1 second creates token that expires quickly", () => {
		const result = createToken("test-session", SECRET, 1);

		assert.ok(result.token, "Token should be created with TTL of 1");

		// token should be valid immediately
		const payload = verifyToken(result.token, SECRET);
		assert.notEqual(payload, null, "Token with TTL of 1 should be valid immediately");
		assert.equal(payload!.exp - payload!.iat, 1, "TTL should be 1 second");
	});

	test("TTL of maximum safe integer creates valid token", () => {
		const maxSafeTTL = Number.MAX_SAFE_INTEGER;
		const result = createToken("test-session", SECRET, maxSafeTTL);

		assert.ok(result.token, "Token should be created with maximum safe integer TTL");

		// verify token can be verified
		const payload = verifyToken(result.token, SECRET);
		assert.notEqual(payload, null, "Token with max safe integer TTL should be verifiable");

		// verify TTL is preserved (within reasonable bounds due to timing)
		const actualTTL = payload!.exp - payload!.iat;
		assert.equal(actualTTL, maxSafeTTL, "TTL should be preserved");
	});

	test("negative TTL creates expired token", () => {
		const result = createToken("test-session", SECRET, -3600);

		assert.ok(result.token, "Token should be created with negative TTL");

		// token should be expired
		const payload = verifyToken(result.token, SECRET);
		assert.equal(payload, null, "Token with negative TTL should be expired");
	});

	test("verifyToken handles null input", () => {
		// @ts-expect-error - testing null input
		const payload = verifyToken(null, SECRET);
		assert.equal(payload, null, "verifyToken should return null for null input");
	});

	test("verifyToken handles undefined input", () => {
		// @ts-expect-error - testing undefined input
		const payload = verifyToken(undefined, SECRET);
		assert.equal(payload, null, "verifyToken should return null for undefined input");
	});

	test("verifyToken handles empty string", () => {
		const payload = verifyToken("", SECRET);
		assert.equal(payload, null, "verifyToken should return null for empty string");
	});

	test("verifyToken handles whitespace-only string", () => {
		const payload = verifyToken("   ", SECRET);
		assert.equal(payload, null, "verifyToken should return null for whitespace-only string");
	});

	test("verifyToken handles token with only dots", () => {
		const payload = verifyToken("...", SECRET);
		assert.equal(payload, null, "verifyToken should return null for token with only dots");
	});

	test("verifyToken handles token with null secret", () => {
		const result = createToken("test-session", SECRET);
		// @ts-expect-error - testing null secret
		const payload = verifyToken(result.token, null);
		assert.equal(payload, null, "verifyToken should return null for null secret");
	});

	test("verifyToken handles token with undefined secret", () => {
		const result = createToken("test-session", SECRET);
		// @ts-expect-error - testing undefined secret
		const payload = verifyToken(result.token, undefined);
		assert.equal(payload, null, "verifyToken should return null for undefined secret");
	});

	test("verifyToken handles token with empty secret", () => {
		const result = createToken("test-session", SECRET);
		const payload = verifyToken(result.token, "");
		assert.equal(payload, null, "verifyToken should return null for empty secret");
	});

	test("verifyToken handles token with wrong secret", () => {
		const result = createToken("test-session", SECRET);
		const payload = verifyToken(result.token, "wrong-secret");
		assert.equal(payload, null, "verifyToken should return null for wrong secret");
	});
});
