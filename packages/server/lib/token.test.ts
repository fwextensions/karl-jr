import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import * as fc from "fast-check";
import { createToken, verifyToken } from "./token.js";

/**
 * Helper to decode the payload from a JWT (3-part format: header.payload.signature).
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
	const parts = token.split(".");
	const payloadJson = Buffer.from(parts[1], "base64url").toString("utf-8");
	return JSON.parse(payloadJson);
}

/**
 * fast-check wrapper for async property tests
 */
async function assertAsync<T extends unknown[]>(
	arb: fc.Arbitrary<T>,
	predicate: (...args: T) => Promise<void>,
	opts = { numRuns: 100 }
) {
	// collect samples from the arbitrary
	const samples = fc.sample(arb, opts.numRuns);
	for (const sample of samples) {
		await predicate(...sample);
	}
}

describe("Token Creation Properties", () => {
	// **Validates: Requirements 1.1, 1.5**
	test("Property 1: Token creation produces valid fingerprints", async () => {
		await assertAsync(
			fc.tuple(
				fc.string({ minLength: 8, maxLength: 256 }),
				fc.string({ minLength: 32, maxLength: 64 })
			) as fc.Arbitrary<[string, string]>,
			async (sessionId: string, secret: string) => {
				const result = await createToken(sessionId, secret);

				const expectedFingerprint = createHash("sha256")
					.update(sessionId)
					.digest("hex");

				const payload = decodeJwtPayload(result.token);

				assert.equal(
					payload.sfp,
					expectedFingerprint,
					"Token payload must contain SHA-256 hash of session ID"
				);
				assert.equal(typeof payload.sfp, "string");
				assert.equal(
					(payload.sfp as string).length,
					64,
					"Session fingerprint must be 64 hex characters (SHA-256)"
				);
				assert.notEqual(
					payload.sfp,
					sessionId,
					"Session fingerprint must not be the raw session ID"
				);

				// verify no field contains the raw session ID
				const payloadValues = Object.values(payload).filter(v => typeof v === "string");
				for (const value of payloadValues) {
					if (value === sessionId) {
						assert.fail("Token payload must not contain raw session ID as a value");
					}
				}
			}
		);
	});

	// **Validates: Requirements 1.2**
	test("Property 2: Token creation includes required timestamps", async () => {
		await assertAsync(
			fc.tuple(
				fc.string({ minLength: 8, maxLength: 256 }),
				fc.string({ minLength: 32, maxLength: 64 }),
				fc.integer({ min: 1, max: 86400 })
			) as fc.Arbitrary<[string, string, number]>,
			async (sessionId: string, secret: string, ttlSeconds: number) => {
				const beforeCreation = Math.floor(Date.now() / 1000);
				const result = await createToken(sessionId, secret, ttlSeconds);
				const afterCreation = Math.floor(Date.now() / 1000);

				const payload = decodeJwtPayload(result.token);

				assert.equal(typeof payload.iat, "number");
				assert.equal(typeof payload.exp, "number");

				const iat = payload.iat as number;
				const exp = payload.exp as number;

				assert.ok(
					iat >= beforeCreation && iat <= afterCreation,
					`iat (${iat}) must be between ${beforeCreation} and ${afterCreation}`
				);
				assert.ok(iat <= exp);
				assert.equal(exp, iat + ttlSeconds);
			}
		);
	});

	// **Validates: Requirements 1.4**
	test("Property 3: Token format is standard JWT (3 parts)", async () => {
		await assertAsync(
			fc.tuple(
				fc.string({ minLength: 8, maxLength: 256 }),
				fc.string({ minLength: 32, maxLength: 64 }),
				fc.integer({ min: 1, max: 86400 })
			) as fc.Arbitrary<[string, string, number]>,
			async (sessionId: string, secret: string, ttlSeconds: number) => {
				const result = await createToken(sessionId, secret, ttlSeconds);

				assert.equal(typeof result.token, "string");

				// JWT has exactly 3 parts (header.payload.signature)
				const parts = result.token.split(".");
				assert.equal(parts.length, 3, "JWT must contain exactly two dot separators");

				for (const part of parts) {
					assert.ok(part.length > 0, "Each JWT part must be non-empty");
					assert.ok(
						/^[A-Za-z0-9_-]+$/.test(part),
						"Each JWT part must be valid base64url"
					);
				}

				// verify header specifies HS256
				const headerJson = Buffer.from(parts[0], "base64url").toString("utf-8");
				const header = JSON.parse(headerJson);
				assert.equal(header.alg, "HS256");

				// verify payload has expected claims
				const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
				assert.ok("sfp" in payload);
				assert.ok("iat" in payload);
				assert.ok("exp" in payload);
			}
		);
	});
});

describe("Token Verification Properties", () => {
	// **Validates: Requirements 2.6**
	test("Property 4: Token verification is a round-trip", async () => {
		await assertAsync(
			fc.tuple(
				fc.string({ minLength: 8, maxLength: 256 }),
				fc.string({ minLength: 32, maxLength: 64 }),
				fc.integer({ min: 1, max: 86400 })
			) as fc.Arbitrary<[string, string, number]>,
			async (sessionId: string, secret: string, ttlSeconds: number) => {
				const result = await createToken(sessionId, secret, ttlSeconds);
				const verifiedPayload = await verifyToken(result.token, secret);

				assert.notEqual(verifiedPayload, null, "Token verification must succeed");

				const expectedFingerprint = createHash("sha256")
					.update(sessionId)
					.digest("hex");

				assert.equal(verifiedPayload!.sfp, expectedFingerprint);
				assert.equal(verifiedPayload!.exp - verifiedPayload!.iat, ttlSeconds);
			}
		);
	});

	// **Validates: Requirements 2.2**
	test("Property 5: Invalid signatures are rejected", async () => {
		await assertAsync(
			fc.tuple(
				fc.string({ minLength: 8, maxLength: 256 }),
				fc.string({ minLength: 32, maxLength: 64 }),
				fc.integer({ min: 1, max: 86400 })
			) as fc.Arbitrary<[string, string, number]>,
			async (sessionId: string, secret: string, ttlSeconds: number) => {
				const result = await createToken(sessionId, secret, ttlSeconds);
				const parts = result.token.split(".");

				// tamper with the signature
				const sig = parts[2];
				if (sig.length === 0) return;

				const tamperedChar = sig[0] === "A" ? "B" : "A";
				const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedChar}${sig.slice(1)}`;

				const verifiedPayload = await verifyToken(tamperedToken, secret);
				assert.equal(verifiedPayload, null, "Token with tampered signature must be rejected");
			}
		);
	});

	// **Validates: Requirements 2.3**
	test("Property 6: Expired tokens are rejected", async () => {
		await assertAsync(
			fc.tuple(
				fc.string({ minLength: 8, maxLength: 256 }),
				fc.string({ minLength: 32, maxLength: 64 }),
				fc.integer({ min: -86400, max: -1 })
			) as fc.Arbitrary<[string, string, number]>,
			async (sessionId: string, secret: string, ttlSeconds: number) => {
				const result = await createToken(sessionId, secret, ttlSeconds);
				const verifiedPayload = await verifyToken(result.token, secret);
				assert.equal(verifiedPayload, null, "Expired token must be rejected");
			}
		);
	});

	// **Validates: Requirements 2.4, 2.5**
	test("Property 7: Malformed tokens are rejected", async () => {
		await assertAsync(
			fc.tuple(
				fc.oneof(
					// tokens with no dot separator
					fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.includes(".")),
					// tokens with wrong number of parts
					fc.tuple(
						fc.string({ minLength: 1, maxLength: 50 }),
						fc.string({ minLength: 1, maxLength: 50 })
					).map(([a, b]) => `${a}.${b}`),
					// empty parts
					fc.constant("."),
					fc.constant(".."),
					fc.string({ minLength: 1, maxLength: 50 }).map(s => `${s}.`),
					fc.string({ minLength: 1, maxLength: 50 }).map(s => `.${s}`)
				),
				fc.string({ minLength: 32, maxLength: 64 })
			) as fc.Arbitrary<[string, string]>,
			async (malformedToken: string, secret: string) => {
				const verifiedPayload = await verifyToken(malformedToken, secret);
				assert.equal(
					verifiedPayload,
					null,
					`Malformed token "${malformedToken}" must be rejected`
				);
			}
		);
	});
});

describe("Token Edge Cases", () => {
	const SECRET = "test-secret-key-with-sufficient-length-for-hmac";

	test("empty session ID creates valid token", async () => {
		const result = await createToken("", SECRET);

		assert.ok(result.token);
		assert.ok(result.expiresAt instanceof Date);

		const payload = await verifyToken(result.token, SECRET);
		assert.notEqual(payload, null);

		const expectedFingerprint = createHash("sha256").update("").digest("hex");
		assert.equal(payload!.sfp, expectedFingerprint);
	});

	test("very long session ID (>1KB) creates valid token", async () => {
		const longSessionId = "a".repeat(2048);
		const result = await createToken(longSessionId, SECRET);

		assert.ok(result.token);

		const payload = await verifyToken(result.token, SECRET);
		assert.notEqual(payload, null);

		const expectedFingerprint = createHash("sha256").update(longSessionId).digest("hex");
		assert.equal(payload!.sfp, expectedFingerprint);
	});

	test("session ID with special characters creates valid token", async () => {
		const specialChars = "!@#$%^&*()[]{}|\\:;\"'<>,.?/~`\n\t\r";
		const result = await createToken(specialChars, SECRET);

		assert.ok(result.token);

		const payload = await verifyToken(result.token, SECRET);
		assert.notEqual(payload, null);

		const expectedFingerprint = createHash("sha256").update(specialChars).digest("hex");
		assert.equal(payload!.sfp, expectedFingerprint);
	});

	test("session ID with unicode characters creates valid token", async () => {
		const unicode = "你好世界🌍🚀";
		const result = await createToken(unicode, SECRET);

		assert.ok(result.token);

		const payload = await verifyToken(result.token, SECRET);
		assert.notEqual(payload, null);

		const expectedFingerprint = createHash("sha256").update(unicode).digest("hex");
		assert.equal(payload!.sfp, expectedFingerprint);
	});

	test("TTL of 0 seconds creates immediately expired token", async () => {
		const result = await createToken("test-session", SECRET, 0);

		assert.ok(result.token);

		const payload = await verifyToken(result.token, SECRET);
		assert.equal(payload, null, "Token with TTL of 0 should be immediately expired");
	});

	test("TTL of 1 second creates token that expires quickly", async () => {
		const result = await createToken("test-session", SECRET, 1);

		assert.ok(result.token);

		const payload = await verifyToken(result.token, SECRET);
		assert.notEqual(payload, null);
		assert.equal(payload!.exp - payload!.iat, 1);
	});

	test("negative TTL creates expired token", async () => {
		const result = await createToken("test-session", SECRET, -3600);

		assert.ok(result.token);

		const payload = await verifyToken(result.token, SECRET);
		assert.equal(payload, null, "Token with negative TTL should be expired");
	});

	test("verifyToken handles null input", async () => {
		// @ts-expect-error - testing null input
		const payload = await verifyToken(null, SECRET);
		assert.equal(payload, null);
	});

	test("verifyToken handles undefined input", async () => {
		// @ts-expect-error - testing undefined input
		const payload = await verifyToken(undefined, SECRET);
		assert.equal(payload, null);
	});

	test("verifyToken handles empty string", async () => {
		const payload = await verifyToken("", SECRET);
		assert.equal(payload, null);
	});

	test("verifyToken handles whitespace-only string", async () => {
		const payload = await verifyToken("   ", SECRET);
		assert.equal(payload, null);
	});

	test("verifyToken handles token with only dots", async () => {
		const payload = await verifyToken("...", SECRET);
		assert.equal(payload, null);
	});

	test("verifyToken handles token with null secret", async () => {
		const result = await createToken("test-session", SECRET);
		// @ts-expect-error - testing null secret
		const payload = await verifyToken(result.token, null);
		assert.equal(payload, null);
	});

	test("verifyToken handles token with undefined secret", async () => {
		const result = await createToken("test-session", SECRET);
		// @ts-expect-error - testing undefined secret
		const payload = await verifyToken(result.token, undefined);
		assert.equal(payload, null);
	});

	test("verifyToken handles token with empty secret", async () => {
		const result = await createToken("test-session", SECRET);
		const payload = await verifyToken(result.token, "");
		assert.equal(payload, null);
	});

	test("verifyToken handles token with wrong secret", async () => {
		const result = await createToken("test-session", SECRET);
		const payload = await verifyToken(result.token, "wrong-secret");
		assert.equal(payload, null);
	});
});
