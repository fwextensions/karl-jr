# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Karl Jr. is a cross-browser extension that provides content management information for SF.gov pages. The extension displays a side panel when users navigate SF.gov pages, showing metadata and administrative links retrieved from the Wagtail CMS API.

## Monorepo Structure

This is an npm workspaces monorepo with three packages:

- **`packages/extension`** - Browser extension (React + Vite + CRXJS)
- **`packages/server`** - Vercel serverless API endpoints
- **`packages/shared`** - Shared TypeScript types

## Common Commands

### Development

```bash
# Start extension dev server with HMR
npm run dev:extension

# Start local API server (recommended for Windows)
cd packages/server && npm run dev

# Start API via Vercel dev (slower on Windows due to libuv bug)
cd packages/server && npm run dev:vercel

# Install dependencies for all workspaces
npm install
```

### Building

```bash
# Build all workspaces
npm run build

# Build extension only
npm run build:extension

# Build server only
npm run build:server
```

### Releasing

```bash
# Interactive release: bumps version, builds, tags, and pushes
npm run release
```

The release script (`scripts/release.js`) accepts `patch`, `minor`, `major`, or an explicit version string.  It must be run from the `main` branch with a clean working tree.

### Testing

```bash
# Run extension tests
npm test --workspace=@sf-gov/extension

# Run server tests
npm test --workspace=@sf-gov/server
```

### Type Checking

```bash
# Check types across all workspaces
npm run type-check

# Check types in a specific workspace
npm run type-check --workspace=@sf-gov/extension
```

### Working with Workspaces

```bash
# Add dependency to extension
npm install <package> --workspace=@sf-gov/extension

# Add dependency to server
npm install <package> --workspace=@sf-gov/server

# Run script in specific workspace
npm run <script> --workspace=@sf-gov/extension
```

## Architecture

### Extension Architecture

The extension has four main components:

1. **Background Service Worker** (`src/background/service-worker.ts`)
   - Manages side panel visibility based on URL (only shows on `*.sf.gov` domains)
   - Handles "Edit on Karl" context menu functionality with side panel persistence
   - Forwards messages between content scripts and side panel
   - Updates dynamically as user navigates tabs

2. **Side Panel** (`src/sidepanel/`)
   - React 19 application displaying page metadata
   - Main hook: `useSfGovPage()` orchestrates all data fetching and state
   - Components render cards for different features (metadata, feedback, link checker, accessibility, media assets, etc.)
   - Communicates with both Wagtail API directly and proxy API for privileged operations
   - On admin pages, displays an iframe preview of the public page

3. **Content Script: Admin Preview Monitor** (`src/content/admin-preview-monitor.ts`)
   - Injected into `api.sf.gov/admin/*` pages
   - Monitors the Wagtail preview button state using MutationObserver
   - Forwards preview URL updates to side panel via background worker
   - Includes retry logic and exponential backoff for button detection

4. **Content Script: Next Data Extractor** (`src/content/next-data-extractor.ts`)
   - Injected into public `*.sf.gov` pages (excluding `api.sf.gov`)
   - Extracts page data from the `__NEXT_DATA__` script tag in the DOM
   - Transforms raw data into `WagtailPage` objects via `page-data-transformer.ts`
   - Sends extracted data to the side panel via the background worker
   - Responds to `REQUEST_PAGE_DATA` messages for on-demand re-extraction

### Server Architecture

The server provides these Vercel serverless endpoints:

1. **`/api/auth/token`** - JWT token exchange endpoint
   - Accepts Wagtail session ID via `X-Wagtail-Session` header
   - Validates session against Wagtail API
   - Returns a signed JWT companion token (HS256, configurable TTL)
   - Session validation cached in Redis (5min TTL)

2. **`/api/feedback`** - Proxies user feedback data from Airtable
   - Requires companion JWT token authentication (via `Authorization: Bearer` header)
   - Uses Redis (Upstash) for caching feedback data (2hr TTL)
   - Fetches all records matching page path with pagination
   - Calculates helpful/not-helpful statistics

3. **`/api/link-check`** - Server-side link validation with SSE streaming
   - Validates HTTP/HTTPS links and streams results via Server-Sent Events
   - Requires companion JWT token authentication
   - Rate limiting: max 10 concurrent requests, 100ms delay per domain
   - Retry logic: 2 retries with exponential backoff (100ms, 200ms)
   - 60 second maximum execution time
   - Handles mixed content detection, redirects, SSL errors
   - Special handling for twitter.com/x.com domains

4. **`/api/health`** - Health check endpoint

### API Client Architecture

- **`wagtail-client.ts`** - Direct Wagtail API calls from extension (fallback path)
  - Auto-detects production vs staging based on current URL
  - Finds pages by ID or slug with translation support
  - Extracts images, files, and metadata recursively
  - 10-second timeout with AbortController
  - Custom headers: `User-Agent: SF-Gov-Companion-Extension/1.0` and `X-SF-Gov-Extension: companion`

- **`page-data-transformer.ts`** - Transforms `__NEXT_DATA__` page props into `WagtailPage` objects (primary data path)
  - Extracts images, files, translations, agencies, form schemas, and form confirmations
  - Handles production and staging admin URL generation

- **`auth.ts`** - Token lifecycle management
  - Exchanges Wagtail session cookie for companion JWT token
  - Caches tokens in both memory and `chrome.storage.session`
  - Proactive refresh 60 seconds before expiry

- **`airtable-client.ts`** - Calls proxy for feedback data (uses companion token)

- **`link-check-client.ts`** - SSE client for link checking (uses companion token)

### Authentication Flow

1. Extension reads `sessionid` cookie from `api.sf.gov` via `chrome.cookies` API
2. Extension calls `POST /api/auth/token` with session ID in `X-Wagtail-Session` header
3. Server validates session against Wagtail API, returns signed JWT
4. Extension caches JWT in memory and `chrome.storage.session`
5. Subsequent API calls use `Authorization: Bearer <token>` header
6. Token is proactively refreshed 60 seconds before expiry
7. On 401 responses, cached token is cleared and re-exchanged

### Environment Configuration

**Extension** (`.env.local` for local dev):
```
VITE_API_BASE_URL=http://localhost:3000
VITE_POSTHOG_API_KEY=<optional, leave empty to disable analytics>
```

**Server** (`.env`):
```
WAGTAIL_API_URL=https://api.sf.gov/admin
TOKEN_SIGNING_SECRET=<HS256 signing key, min 32 chars>
TOKEN_TTL_SECONDS=900
AIRTABLE_API_KEY=<key>
AIRTABLE_BASE_ID=<id>
AIRTABLE_TABLE_NAME=<name>
UPSTASH_REDIS_REST_URL=<url>
UPSTASH_REDIS_REST_TOKEN=<token>
SESSION_CACHE_TTL=300
WAGTAIL_VALIDATION_TIMEOUT=5000
```

## Key Technical Details

### Chrome Extension Manifest V3

- Uses `sidePanel` API for side panel UI
- Requires permissions: `sidePanel`, `tabs`, `scripting`, `cookies`, `contextMenus`, `storage`
- Host permissions for `*.sf.gov/*`, `api.sf.gov/*`, `api.staging.dev.sf.gov/*`
- Two content scripts:
  - Admin preview monitor on `api.sf.gov/admin/*` and staging equivalent
  - Next data extractor on `*.sf.gov/*` (excluding `api.sf.gov/*`)
- Keyboard shortcut: `Alt+K` (Windows) / `Ctrl+K` (Mac) to open side panel

### TypeScript Configuration

Strict mode enabled across all workspaces:
- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`

### Build Output

- Extension builds to `packages/extension/dist/`
- Distribution zip created in `packages/extension/release/`
- Load unpacked extension from `dist/` directory in Chrome

### Loading Extension for Testing

1. Build: `npm run build:extension`
2. Navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `packages/extension/dist/` directory

### URL Patterns

The extension operates on these patterns:
- Public pages: `https://*.sf.gov/*` (including staging: `*.staging.dev.sf.gov`)
- Admin pages: `https://api.sf.gov/admin/*` and staging equivalent
- API endpoints: `https://api.sf.gov/api/v2/*` and staging equivalent

### Link Checker Requirements

When modifying link checker functionality, be aware of these requirements:
- Maximum 200 URLs per request
- Maximum 10 concurrent requests
- 100ms delay between requests to same domain
- 2 retries with exponential backoff (100ms, 200ms)
- 10 second timeout per link
- 60 second maximum total execution time
- Special handling for bare `https://sf.gov` (redirects to `www.sf.gov`)
- Special handling for twitter.com/x.com (attempt validation, don't retry on failure)
- Mixed content detection (HTTP on HTTPS page)
- Client disconnection handling (stop processing immediately)

## Development Notes

### Windows Performance Issue

`vercel dev` has significant performance issues on Windows (5+ second response delays) due to a libuv bug.  Use the lightweight Node dev server instead: `cd packages/server && npm run dev`

### Shared Types Package

The `@sf-gov/shared` package exports TypeScript types used by both extension and server:
- Wagtail API types (`WagtailPage`, `MediaAsset`, `Translation`, `Agency`, `FormSchema`, etc.)
- Airtable API types (`FeedbackRecord`, `FeedbackResponse`, etc.)
- Link check types (`LinkCheckRequest`, `LinkCheckResultEvent`, etc.)
- Auth types (`TokenResponse`, `TokenErrorResponse`)

Changes to shared types require rebuilding the shared package or restarting TypeScript in your editor.

### Extension Identification Headers

All requests to `api.sf.gov` include these headers for logging:
- `User-Agent: SF-Gov-Companion-Extension/1.0`
- `X-SF-Gov-Extension: companion`

These are sent in extension → Wagtail API calls and server → Wagtail API calls.

### Analytics

The extension uses PostHog for analytics (`src/lib/analytics.ts`).  Analytics are disabled when `VITE_POSTHOG_API_KEY` is not set.  Events are tracked for side panel views, edit button clicks, context menu usage, and errors.

## Code Style Guidelines

Based on `.kiro/steering/tech.md`:

- Always use JavaScript or TypeScript for code (never Python)
- Always use tabs for indentation
- Always use double quotes
- Always use semicolons
- Always use LF line endings, even on Windows
- Use trailing commas in object and array literals, but not in function parameters
- Use `const` for declarations unless the variable will be re-assigned
- Use `let` for declarations that will be re-assigned
- Generally use functional and declarative programming patterns; use classes if it makes sense to manage many instances
- Prefer iteration and modularization over code duplication
- Use descriptive variable names with auxiliary verbs (e.g., `isLoading`, `hasError`)
- In comments, start with a lowercase letter and do not end with a period unless the comment contains multiple sentences.  If a period is included, use two spaces after the period.
- When writing commit messages, use the present tense.  Use a summary line, then a blank line, then a fairly detailed list of changes.  The commit message should almost never be a single line.

## Target Users

Content managers and administrators working with SF.gov's Wagtail CMS who need quick access to page metadata and admin links while browsing the live site.

## Detailed Feature Specifications

Feature specifications and requirements are documented in `.kiro/specs/`.  Key implemented features:

- **Domain-based side panel visibility** - Side panel only appears on `*.sf.gov` domains
- **`__NEXT_DATA__` page extraction** - Primary data source via content script DOM extraction
- **Admin preview integration** - Content script monitors preview button state in Wagtail admin
- **Edit with side panel persistence** - Edit button opens admin in adjacent tab with side panel kept open
- **Airtable feedback integration** - Displays user feedback from Airtable with caching
- **Server-side link checking** - SSE-based link validation with rate limiting and retry logic
- **Token exchange authentication** - JWT-based auth flow replacing direct session passing
- **Accessibility checker** - Client-side image alt text validation
- **PostHog analytics** - Event tracking for usage patterns and errors
- **Monorepo structure** - Three-package workspace setup with shared types

When working on new features or investigating bugs, consult the relevant spec documents in `.kiro/specs/` for detailed requirements and design decisions.
