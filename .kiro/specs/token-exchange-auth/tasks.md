# Implementation Plan: Token Exchange Authentication

## Overview

This implementation replaces session-based authentication with a token exchange system. The work is organized into three phases: shared types, server implementation with backward compatibility, and extension implementation. Each phase builds incrementally, with property tests placed close to implementation to catch errors early.

## Tasks

- [x] 1. Create shared authentication types
	- Create `packages/shared/src/types/auth.ts` with TokenResponse and TokenErrorResponse interfaces
	- Export auth types from `packages/shared/src/types/index.ts`
	- _Requirements: 11.1, 11.2, 11.3_

- [x] 2. Implement server token module
	- [x] 2.1 Create token creation function
		- Implement `createToken()` in `packages/server/lib/token.ts`
		- Compute SHA-256 session fingerprint
		- Build payload with sfp, iat, exp fields
		- Sign with HMAC-SHA256
		- Encode as base64url(payload).base64url(hmac)
		- _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
	
	- [x] 2.2 Write property test for token creation
		- **Property 1: Token creation produces valid fingerprints**
		- **Validates: Requirements 1.1, 1.5**
	
	- [x] 2.3 Write property test for token format
		- **Property 2: Token creation includes required timestamps**
		- **Property 3: Token format is consistent**
		- **Validates: Requirements 1.2, 1.4**
	
	- [x] 2.4 Create token verification function
		- Implement `verifyToken()` in `packages/server/lib/token.ts`
		- Split token on dot separator
		- Verify HMAC signature using timing-safe comparison
		- Check expiration timestamp
		- Return decoded payload or null
		- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
	
	- [x] 2.5 Write property test for token verification round-trip
		- **Property 4: Token verification is a round-trip**
		- **Validates: Requirements 2.6**
	
	- [x] 2.6 Write property test for token rejection cases
		- **Property 5: Invalid signatures are rejected**
		- **Property 6: Expired tokens are rejected**
		- **Property 7: Malformed tokens are rejected**
		- **Validates: Requirements 2.2, 2.3, 2.4, 2.5**
	
	- [x] 2.7 Write unit tests for token edge cases
		- Test empty session ID, very long session IDs, special characters
		- Test TTL edge cases (0 seconds, maximum safe integer)
		- Test null/undefined input handling
		- _Requirements: 1.1, 1.2, 2.2, 2.3, 2.4, 2.5_

- [x] 3. Checkpoint - Ensure token module tests pass
	- Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement token exchange endpoint
	- [x] 4.1 Create token exchange serverless function
		- Create `packages/server/api/auth/token.ts`
		- Validate CORS origin
		- Check POST method only
		- Extract session ID from X-Wagtail-Session header
		- Call validateWagtailSession
		- Create token using token module
		- Return TokenResponse with token and expiresAt
		- _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
	
	- [~] 4.2 Write property test for token exchange with valid sessions
		- **Property 8: Token exchange returns valid tokens for valid sessions**
		- **Validates: Requirements 3.2**
	
	- [~] 4.3 Write property test for token exchange rejection
		- **Property 9: Token exchange rejects invalid sessions**
		- **Property 10: Token exchange validates origins**
		- **Validates: Requirements 3.3, 3.4**
	
	- [~] 4.4 Write unit tests for token exchange endpoint
		- Test GET/PUT/DELETE method rejection (405)
		- Test missing X-Wagtail-Session header (401)
		- Test invalid origin (403)
		- Test Wagtail API timeout and 500 errors
		- _Requirements: 3.3, 3.4, 3.5_

- [x] 5. Update server auth library
	- Add `extractBearerToken()` helper to `packages/server/lib/auth.ts`
	- Extract token from Authorization header
	- Return null if missing or not "Bearer " prefix
	- _Requirements: 4.2, 5.2_

- [ ] 6. Update feedback endpoint with backward compatibility
	- [x] 6.1 Add token-based authentication to feedback endpoint
		- Update `packages/server/api/feedback.ts`
		- Check for Authorization header first
		- Extract bearer token using extractBearerToken
		- Verify token using verifyToken
		- Fall back to X-Wagtail-Session if no Authorization header
		- Remove session cache Redis operations for token auth
		- Update CORS headers to include Authorization
		- Update logs to use session fingerprint
		- Add TOKEN_SIGNING_SECRET to ProxyEnv interface
		- _Requirements: 4.1, 4.2, 4.3, 4.6, 8.1, 8.2, 8.5_
	
	- [~] 6.2 Write property test for feedback endpoint auth
		- **Property 11: Endpoints reject malformed authorization headers**
		- **Property 12: Endpoints reject invalid tokens**
		- **Validates: Requirements 4.2, 4.3**
	
	- [~] 6.3 Write unit tests for feedback endpoint backward compatibility
		- Test Authorization header takes precedence
		- Test fallback to X-Wagtail-Session when no Authorization
		- Test CORS headers include both auth methods
		- _Requirements: 8.1, 8.2, 8.5_

- [ ] 7. Update link check endpoint with backward compatibility
	- [x] 7.1 Add token-based authentication to link check endpoint
		- Update `packages/server/api/link-check.ts`
		- Replace extractWagtailSessionId with extractBearerToken
		- Verify token using verifyToken
		- Fall back to X-Wagtail-Session if no Authorization header
		- Update CORS headers to include Authorization
		- Update logs to use session fingerprint
		- Add TOKEN_SIGNING_SECRET to env validation
		- _Requirements: 5.1, 5.2, 5.3, 5.5, 8.3, 8.4_
	
	- [~] 7.2 Write unit tests for link check endpoint backward compatibility
		- Test Authorization header takes precedence
		- Test fallback to X-Wagtail-Session when no Authorization
		- Test SSE streaming still works with token auth
		- _Requirements: 8.3, 8.4_

- [~] 8. Checkpoint - Ensure server tests pass and deploy
	- Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement extension auth module
	- [x] 9.1 Create auth module with token management
		- Create `packages/extension/src/api/auth.ts`
		- Implement getAuthToken() with in-memory and storage caching
		- Check in-memory cache first
		- Check chrome.storage.session if not in memory
		- Perform token exchange if not cached or near expiry (< 60s)
		- Implement exchangeToken() to call /api/auth/token
		- Implement clearAuthToken() to clear both caches
		- Move getWagtailSessionId() from airtable-client.ts
		- _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6_
	
	- [~] 9.2 Write property test for extension token caching
		- **Property 13: Extension caches valid tokens**
		- **Property 14: Extension refreshes near-expired tokens**
		- **Validates: Requirements 6.1, 6.2, 6.3**
	
	- [~] 9.3 Write unit tests for auth module error handling
		- Test no session cookie error message
		- Test 401 from exchange error message
		- Test 500 from exchange error message
		- Test network error handling
		- Test concurrent token exchange requests
		- _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 10. Update airtable client to use token auth
	- [x] 10.1 Replace session auth with token auth in airtable client
		- Update `packages/extension/src/api/airtable-client.ts`
		- Import getAuthToken and clearAuthToken from auth module
		- Remove getWagtailSessionId function
		- Replace X-Wagtail-Session header with Authorization: Bearer
		- Add retry-on-401 loop (max 2 attempts)
		- Clear token and retry once on 401
		- Throw auth error if retry also fails
		- _Requirements: 6.4, 9.5_
	
	- [~] 10.2 Write property test for retry logic
		- **Property 15: Extension retries on 401**
		- **Validates: Requirements 6.4**
	
	- [~] 10.3 Write unit tests for airtable client retry
		- Test 401 on first attempt triggers retry
		- Test 401 on both attempts propagates error
		- Test token refresh during long-running operations
		- _Requirements: 6.4, 9.5_

- [ ] 11. Update link check client to use token auth
	- [x] 11.1 Replace session auth with token auth in link check client
		- Update `packages/extension/src/api/link-check-client.ts`
		- Import getAuthToken and clearAuthToken from auth module
		- Remove private getWagtailSessionId method
		- Replace X-Wagtail-Session header with Authorization: Bearer
		- Add retry-on-401 logic in startCheck method
		- _Requirements: 6.4, 9.5_
	
	- [~] 11.2 Write unit tests for link check client retry
		- Test retry logic with 401 responses
		- Test SSE streaming continues after token refresh
		- _Requirements: 6.4_

- [ ] 12. Add environment variable configuration
	- [~] 12.1 Update server environment validation
		- Add TOKEN_SIGNING_SECRET to required env vars
		- Add TOKEN_TTL_SECONDS to optional env vars with default 900
		- Update validateEnv in feedback.ts and link-check.ts
		- _Requirements: 7.3, 7.4_
	
	- [~] 12.2 Write property test for TTL configuration
		- **Property 16: Token TTL respects configuration**
		- **Property 17: Different secrets produce incompatible tokens**
		- **Validates: Requirements 7.1, 7.4**
	
	- [~] 12.3 Write unit tests for environment validation
		- Test server fails to start with missing TOKEN_SIGNING_SECRET
		- Test default TTL of 900 seconds when TOKEN_TTL_SECONDS not set
		- _Requirements: 7.2, 7.3_

- [~] 13. Checkpoint - Ensure all tests pass
	- Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Integration and documentation
	- [x] 14.1 Update environment variable documentation
		- Document TOKEN_SIGNING_SECRET generation with openssl command
		- Document TOKEN_TTL_SECONDS configuration
		- Update deployment guide with migration phases
		- _Requirements: 7.1, 7.3_
	
	- [~] 14.2 Write integration tests
		- Test end-to-end token exchange flow
		- Test feedback endpoint with token auth
		- Test link check endpoint with token auth
		- Test token expiry and refresh during active session
		- Test service worker restart with cached token recovery
		- Test multiple tabs sharing token cache
		- _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6_

- [~] 15. Final checkpoint - Verify all functionality
	- Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties across randomized inputs
- Unit tests validate specific examples, edge cases, and error conditions
- Server changes maintain backward compatibility until Phase 3 migration
- Extension changes can be deployed independently after server Phase 1 is complete
