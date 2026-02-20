# Requirements Document

## Introduction

This document specifies requirements for replacing the current session-based authentication flow with a token exchange authentication system. The current implementation sends raw Wagtail session IDs on every request, creating security risks including credential exposure in logs, plaintext storage in Redis, and unlimited scope if tokens are compromised. The token exchange system will issue short-lived, scoped tokens that are validated locally without external calls, significantly reducing the attack surface while maintaining backward compatibility during migration.

## Glossary

- **Wagtail_Session_ID**: The raw session cookie value from the Wagtail CMS that grants full admin access
- **Companion_Token**: A short-lived, HMAC-signed token issued by the Vercel server for accessing companion API endpoints
- **Session_Fingerprint**: A SHA-256 hash of the Wagtail session ID used for logging and association without exposing the credential
- **Token_Exchange**: The one-time process of trading a Wagtail session ID for a companion token
- **Bearer_Token**: The companion token sent in the Authorization header using the Bearer scheme
- **Extension**: The browser extension that displays SF.gov page information in a side panel
- **Vercel_Server**: The serverless API that proxies Airtable requests and validates authentication
- **Token_Payload**: The JSON data structure containing session fingerprint, issued-at, and expiration timestamps

## Requirements

### Requirement 1: Token Creation and Signing

**User Story:** As a security engineer, I want tokens to be cryptographically signed and contain minimal information, so that leaked tokens cannot be used to access Wagtail admin and cannot expose session credentials.

#### Acceptance Criteria

1. WHEN the server creates a token, THE Token_Creation_Module SHALL compute a SHA-256 hash of the Wagtail session ID and store only the hash in the token payload
2. WHEN the server creates a token, THE Token_Creation_Module SHALL include issued-at and expiration timestamps in the token payload
3. WHEN the server creates a token, THE Token_Creation_Module SHALL sign the payload using HMAC-SHA256 with a server-side secret
4. WHEN the server creates a token, THE Token_Creation_Module SHALL encode the payload and signature as base64url strings separated by a dot
5. THE Token_Creation_Module SHALL NOT include the raw Wagtail session ID in any part of the token

### Requirement 2: Token Verification

**User Story:** As a security engineer, I want tokens to be validated locally without external calls, so that authentication is fast and does not depend on Redis or Wagtail availability.

#### Acceptance Criteria

1. WHEN the server receives a bearer token, THE Token_Verification_Module SHALL verify the HMAC signature using timing-safe comparison
2. WHEN the server receives a bearer token, THE Token_Verification_Module SHALL reject tokens with invalid signatures
3. WHEN the server receives a bearer token, THE Token_Verification_Module SHALL reject tokens that have expired based on the exp timestamp
4. WHEN the server receives a bearer token, THE Token_Verification_Module SHALL reject malformed tokens that do not contain exactly one dot separator
5. WHEN the server receives a bearer token, THE Token_Verification_Module SHALL reject tokens with non-base64url-encoded components
6. WHEN a token passes all validation checks, THE Token_Verification_Module SHALL return the decoded payload

### Requirement 3: Token Exchange Endpoint

**User Story:** As an extension developer, I want a dedicated endpoint to exchange Wagtail session IDs for companion tokens, so that the extension can authenticate without sending session IDs on every request.

#### Acceptance Criteria

1. WHEN the extension sends a POST request to /api/auth/token with a valid Wagtail session ID in the X-Wagtail-Session header, THE Token_Exchange_Endpoint SHALL validate the session against Wagtail
2. WHEN the Wagtail session is valid, THE Token_Exchange_Endpoint SHALL create a companion token and return it with an ISO 8601 expiration timestamp
3. WHEN the Wagtail session is invalid or missing, THE Token_Exchange_Endpoint SHALL return a 401 status code
4. WHEN the request origin is not a valid extension origin, THE Token_Exchange_Endpoint SHALL return a 403 status code
5. WHEN the request method is not POST, THE Token_Exchange_Endpoint SHALL return a 405 status code
6. THE Token_Exchange_Endpoint SHALL NOT cache session validation results in Redis

### Requirement 4: Token-Based Authentication for Feedback Endpoint

**User Story:** As a content manager, I want the feedback endpoint to accept bearer tokens instead of session IDs, so that my Wagtail credentials are not transmitted on every feedback request.

#### Acceptance Criteria

1. WHEN the extension sends a request to /api/feedback with a valid bearer token in the Authorization header, THE Feedback_Endpoint SHALL verify the token and return feedback data
2. WHEN the Authorization header is missing or does not start with "Bearer ", THE Feedback_Endpoint SHALL return a 401 status code
3. WHEN the bearer token is invalid or expired, THE Feedback_Endpoint SHALL return a 401 status code
4. THE Feedback_Endpoint SHALL NOT perform session validation against Wagtail for bearer token requests
5. THE Feedback_Endpoint SHALL NOT cache session IDs in Redis for bearer token requests
6. WHEN logging requests, THE Feedback_Endpoint SHALL log the first 8 characters of the session fingerprint instead of the session ID

### Requirement 5: Token-Based Authentication for Link Check Endpoint

**User Story:** As a content manager, I want the link check endpoint to accept bearer tokens instead of session IDs, so that my Wagtail credentials are not transmitted during link validation.

#### Acceptance Criteria

1. WHEN the extension sends a request to /api/link-check with a valid bearer token in the Authorization header, THE Link_Check_Endpoint SHALL verify the token and perform link checking
2. WHEN the Authorization header is missing or does not start with "Bearer ", THE Link_Check_Endpoint SHALL return a 401 status code
3. WHEN the bearer token is invalid or expired, THE Link_Check_Endpoint SHALL return a 401 status code
4. THE Link_Check_Endpoint SHALL NOT perform session validation against Wagtail for bearer token requests
5. WHEN logging requests, THE Link_Check_Endpoint SHALL log the first 8 characters of the session fingerprint instead of the session ID

### Requirement 6: Extension Token Management

**User Story:** As an extension user, I want authentication to happen transparently in the background, so that I can access page information without manual token management.

#### Acceptance Criteria

1. WHEN the extension needs to make an authenticated request, THE Auth_Module SHALL check for a valid cached token before performing a token exchange
2. WHEN a cached token exists and expires in more than 60 seconds, THE Auth_Module SHALL use the cached token
3. WHEN a cached token does not exist or expires in less than 60 seconds, THE Auth_Module SHALL perform a token exchange
4. WHEN the extension receives a 401 response, THE Auth_Module SHALL clear the cached token and retry the request once with a fresh token
5. WHEN the token exchange fails due to an invalid Wagtail session, THE Auth_Module SHALL throw an error indicating the user needs to log in
6. THE Auth_Module SHALL store tokens in chrome.storage.session so they survive service worker restarts but clear when the browser closes

### Requirement 7: Token Lifecycle Configuration

**User Story:** As a system administrator, I want to configure token lifetime via environment variables, so that I can balance security and user experience based on deployment requirements.

#### Acceptance Criteria

1. WHEN the TOKEN_TTL_SECONDS environment variable is set, THE Token_Creation_Module SHALL use that value as the token lifetime
2. WHEN the TOKEN_TTL_SECONDS environment variable is not set, THE Token_Creation_Module SHALL default to 900 seconds (15 minutes)
3. WHEN the TOKEN_SIGNING_SECRET environment variable is missing, THE Vercel_Server SHALL fail to start and log a configuration error
4. WHEN the TOKEN_SIGNING_SECRET environment variable is present, THE Vercel_Server SHALL use it for all token signing and verification operations

### Requirement 8: Backward Compatibility During Migration

**User Story:** As a deployment engineer, I want the server to accept both token-based and session-based authentication during the migration period, so that existing extension versions continue working while users upgrade.

#### Acceptance Criteria

1. WHEN the feedback endpoint receives a request with an Authorization header, THE Feedback_Endpoint SHALL attempt bearer token authentication
2. WHEN the feedback endpoint receives a request with an X-Wagtail-Session header and no Authorization header, THE Feedback_Endpoint SHALL fall back to legacy session validation
3. WHEN the link check endpoint receives a request with an Authorization header, THE Link_Check_Endpoint SHALL attempt bearer token authentication
4. WHEN the link check endpoint receives a request with an X-Wagtail-Session header and no Authorization header, THE Link_Check_Endpoint SHALL fall back to legacy session validation
5. WHERE backward compatibility is enabled, THE Feedback_Endpoint SHALL include both Authorization and X-Wagtail-Session in CORS Access-Control-Allow-Headers

### Requirement 9: Error Handling and User Feedback

**User Story:** As an extension user, I want clear error messages when authentication fails, so that I understand what action to take to resolve the issue.

#### Acceptance Criteria

1. WHEN the extension cannot find a Wagtail session cookie, THE Auth_Module SHALL throw an error with the message "Not authenticated. Please log in to Wagtail."
2. WHEN the token exchange returns a 401 status, THE Auth_Module SHALL throw an error with the message "Invalid or expired session. Please log in to Wagtail."
3. WHEN the token exchange returns a 500 status, THE Auth_Module SHALL throw an error indicating a server error with the status code
4. WHEN a network error occurs during token exchange, THE Auth_Module SHALL throw an error indicating a connection problem
5. WHEN the extension retries a request after clearing the token and still receives a 401, THE Auth_Module SHALL propagate the authentication error to the UI

### Requirement 10: Security Logging and Monitoring

**User Story:** As a security engineer, I want authentication events to be logged without exposing credentials, so that I can monitor for suspicious activity while maintaining security.

#### Acceptance Criteria

1. WHEN the token exchange endpoint validates a session, THE Token_Exchange_Endpoint SHALL log the first 8 characters of the session fingerprint
2. WHEN the feedback endpoint processes a request, THE Feedback_Endpoint SHALL log the first 8 characters of the session fingerprint from the token payload
3. WHEN the link check endpoint processes a request, THE Link_Check_Endpoint SHALL log the first 8 characters of the session fingerprint from the token payload
4. THE Vercel_Server SHALL NOT log raw Wagtail session IDs in any authentication flow
5. THE Vercel_Server SHALL NOT store raw Wagtail session IDs in Redis for authentication purposes

### Requirement 11: Shared Type Definitions

**User Story:** As a developer, I want authentication types to be shared between the extension and server, so that API contracts are type-safe and consistent.

#### Acceptance Criteria

1. THE Shared_Types_Package SHALL define a TokenResponse interface with token and expiresAt fields
2. THE Shared_Types_Package SHALL define a TokenErrorResponse interface with an error field
3. THE Shared_Types_Package SHALL export all authentication types from the main index file
4. WHEN the server creates a token response, THE Token_Exchange_Endpoint SHALL conform to the TokenResponse interface
5. WHEN the extension receives a token response, THE Auth_Module SHALL parse it according to the TokenResponse interface
