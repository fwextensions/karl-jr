# Karl Jr. — Security & Architecture Overview

## Purpose

This document outlines the security posture, data flow, and permission model for the Karl Jr. browser extension.

## 1. Executive Summary

Karl Jr. is a browser extension designed to assist SF.gov content managers with accessibility testing, readability analysis, and content management. It operates primarily within the user's browser, with targeted server-side communication for authenticated features like user feedback retrieval and link validation.

Karl Jr. does not scrape, store, or transmit Personally Identifiable Information (PII) or sensitive City data to any third-party databases owned by our team. It integrates with existing City infrastructure (Wagtail CMS, Airtable via a proxy) and uses PostHog for anonymous usage analytics.

## 2. Data Flow & Handling

Karl Jr. interacts with several data sources. Here is how each is handled:

### Wagtail CMS API (Page Data)

- **How it works:** Karl Jr. calls the public Wagtail API (`api.sf.gov/api/v2/pages/`) to retrieve page metadata — title, content type, translations, media assets, and edit URLs. This is how the side panel populates page information.
- **Security:** These are read-only GET requests to a public API. The extension adds a `User-Agent` and `X-SF-Gov-Extension` header for identification but does not send authentication credentials for these requests.

### Wagtail CMS Sessions (Authentication)

- **How it works:** Karl Jr. reads the `sessionid` cookie from the `api.sf.gov` or `.sf.gov` domain using the `cookies` permission. This session ID serves two purposes:
  1. **Local use:** Confirming the user is logged into Wagtail so the extension can generate direct "Edit on Karl" links and display authenticated features.
  2. **Server-side authentication:** The session ID is transmitted to the Karl Jr. proxy server (`sfgov-companion-api.vercel.app`) via the `X-Wagtail-Session` HTTP header. The proxy validates this session against the Wagtail API before processing requests for feedback data or link checking.
- **Security:** The session ID is only sent to the SF.gov companion proxy server — never to any other third party. The proxy validates the session by making a server-side request to the Wagtail API and does not store or log session tokens.

### SF.gov Page Content (Accessibility & Readability Testing)

- **How it works:** When a user clicks "Run accessibility check," the extension uses the `scripting` permission to inject analysis functions into the active SF.gov page. These functions parse the DOM to check for heading nesting issues, missing image alt text, table accessibility, video captions, link text quality, and readability scoring.
- **Security:** All DOM analysis happens 100% locally in the user's browser. No page content is sent to external servers. The checks exclude header and footer elements, focusing only on content that editors control.

### Airtable (User Feedback)

- **How it works:** Karl Jr. fetches user feedback data ("helpful/not helpful" ratings and comments) for the current page. The extension does not connect to Airtable directly — it calls the Karl Jr. proxy server (`sfgov-companion-api.vercel.app/api/feedback`), which authenticates the request and then queries Airtable on the server side.
- **Security:** The proxy endpoint is read-only (GET requests only). It cannot create, edit, or delete Airtable records. The Airtable API key is stored server-side and never exposed to the extension. Requests require a valid Wagtail session. The proxy also validates the request origin (must be a browser extension or localhost) and implements Redis caching to reduce Airtable API calls.

### Link Checker

- **How it works:** Karl Jr. includes a link validation feature that sends page URLs to the proxy server (`sfgov-companion-api.vercel.app/api/link-check`) for server-side checking. Results stream back to the extension via Server-Sent Events (SSE).
- **Security:** Requests require a valid Wagtail session. The server enforces a maximum batch size of 200 URLs, rate-limits requests per domain (100ms between requests to the same domain), limits concurrency to 10 simultaneous checks, and enforces a 60-second maximum execution time. Origin validation ensures only browser extensions and localhost can access the endpoint.

### Hemingway App Integration

- **How it works:** If a user wants to check readability externally, the extension copies the page's main content text to the system clipboard. The user then manually pastes it into the Hemingway App.
- **Security:** This requires an explicit, manual user action (clicking a button). The extension does not silently monitor keystrokes, automatically export data, or communicate with Hemingway's servers.

### Analytics (PostHog)

- **How it works:** Karl Jr. uses PostHog for anonymous usage analytics. It tracks events like extension install/update, context menu usage, and errors. A device ID (UUID) is generated and stored in `chrome.storage.local` for session continuity. If the user is logged into Wagtail, their user ID is hashed (SHA-256) to create an anonymous identifier for daily active user tracking.
- **Security:** No PII is collected or transmitted. The Wagtail user ID is one-way hashed before being sent to PostHog. PostHog runs with `persistence: "memory"` (no cookies or localStorage), `autocapture: false`, and `capture_pageview: false`. Analytics data is sent to PostHog's US servers (`us.i.posthog.com`). The PostHog API key is embedded in the extension build via environment variables.

### Content Script (Admin Preview Monitor)

- **How it works:** Karl Jr. injects a content script (`admin-preview-monitor.ts`) into Wagtail admin pages (`api.sf.gov/admin/*` and `api.staging.dev.sf.gov/admin/*`). This script monitors the preview button on CMS edit pages and forwards preview URL updates to the side panel via `chrome.runtime.sendMessage`.
- **Security:** The content script only reads the `href` attribute and disabled state of the preview button element. It does not read or transmit any other page content from admin pages. Communication is internal to the extension (content script → service worker → side panel).

## 3. Chrome Extension Permissions

Karl Jr. follows the principle of least privilege. Each permission in the manifest is justified below:

| Permission | Purpose |
|---|---|
| `sidePanel` | Opens the Karl Jr. side panel UI when the user navigates to SF.gov pages. |
| `tabs` | Detects when the user navigates to or switches between SF.gov pages so the side panel can update accordingly. |
| `scripting` | Injects accessibility and readability analysis scripts into SF.gov pages. Also injects the admin preview monitor into Wagtail admin pages. |
| `cookies` | Reads the Wagtail `sessionid` cookie to authenticate the user for feedback retrieval and link checking. |
| `contextMenus` | Adds an "Edit on Karl" option to the right-click menu on SF.gov pages, allowing quick access to the CMS edit page. |
| `storage` | Stores the PostHog device ID for anonymous analytics continuity across sessions. |

### Host Permissions

| Pattern | Purpose |
|---|---|
| `*://*.sf.gov/*` | Enables the side panel, context menu, and content injection on all SF.gov pages. |
| `https://api.sf.gov/*` | Allows API calls to the Wagtail CMS and cookie access for session authentication. |
| `https://api.staging.dev.sf.gov/*` | Same as above, for the staging environment. |

The extension remains dormant and has no access to data when the user is browsing non-SF.gov websites.

### What Is NOT in the Manifest

- No `activeTab` permission — the extension uses `tabs` and host permissions instead.
- No `clipboardWrite` permission — clipboard access for the Hemingway feature uses the standard `navigator.clipboard` API, which does not require a manifest permission.
- No broad host permissions — the extension cannot access non-SF.gov domains.

## 4. External Services Summary

| Service | URL | Purpose | Auth Required |
|---|---|---|---|
| Wagtail CMS API | `api.sf.gov/api/v2/` | Page metadata (public, read-only) | No |
| Wagtail Admin | `api.sf.gov/admin/` | Edit links, session validation | Session cookie |
| Karl Jr. Proxy | `sfgov-companion-api.vercel.app` | Feedback retrieval, link checking | Wagtail session |
| PostHog | `us.i.posthog.com` | Anonymous usage analytics | API key (embedded) |
| Hemingway App | `hemingwayapp.com` | External readability tool (user-initiated) | None (manual) |

## 5. What Karl Jr. Does NOT Do

- Does not access, read, or store data from non-SF.gov websites
- Does not collect or transmit PII
- Does not store Wagtail session tokens (reads them from browser cookies on each request)
- Does not write to or modify Airtable records
- Does not inject scripts into non-SF.gov pages (except Wagtail admin pages at `api.sf.gov/admin/*`)
- Does not run in the background when the user is not on SF.gov
- Does not use broad permissions like `<all_urls>` or `webRequest`
