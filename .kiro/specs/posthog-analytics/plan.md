# PostHog Analytics Implementation Plan

## Overview

Add PostHog analytics to Karl Jr. extension to track usage metrics and feature engagement for an internal audience of 50-100 SF.gov content managers.

## Goals

- Track overall usage (unique users, sessions, retention)
- Measure feature adoption (edit button, link checker, feedback viewer, etc.)
- Identify most/least used features
- Debug issues with detailed error tracking
- Maintain user privacy and Chrome Web Store compliance

## Phase 1: Rich Event Tracking

### 1.1 Installation

```bash
cd packages/extension
npm install posthog-js uuid
npm install --save-dev @types/uuid
```

### 1.2 Environment Configuration

**Add to `packages/extension/.env.example`:**
```
VITE_POSTHOG_API_KEY=phc_your_key_here
```

**Create `packages/extension/.env.local`:**
```
VITE_POSTHOG_API_KEY=<actual_key_from_posthog>
```

**Verify `.gitignore` includes:**
```
packages/extension/.env.local
```

### 1.3 Create Analytics Module

**File: `packages/extension/src/lib/analytics.ts`**

```typescript
import { PostHog } from "posthog-js/dist/module.no-external";
import { v7 as uuidv7 } from "uuid";

let posthog: PostHog | null = null;
let isInitialized = false;

/**
 * Get or create a shared distinct ID across all extension contexts
 */
async function getSharedDistinctId(): Promise<string> {
	const stored = await chrome.storage.local.get(["posthog_distinct_id"]);
	if (stored.posthog_distinct_id) {
		return stored.posthog_distinct_id;
	}

	const id = uuidv7();
	await chrome.storage.local.set({ posthog_distinct_id: id });
	return id;
}

/**
 * Initialize PostHog analytics
 * Safe to call multiple times - will only initialize once
 */
export async function initAnalytics(): Promise<void> {
	if (isInitialized) return;

	const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
	if (!apiKey) {
		console.log("[Analytics] PostHog disabled: no API key provided");
		return;
	}

	try {
		const distinctId = await getSharedDistinctId();

		posthog = new PostHog();
		posthog.init(apiKey, {
			api_host: "https://us.i.posthog.com",
			disable_external_dependency_loading: true,
			persistence: "localStorage",
			bootstrap: { distinctID: distinctId },
			autocapture: false,
			capture_pageview: false,
			capture_pageleave: false,
			loaded: (ph) => {
				console.log("[Analytics] PostHog initialized with ID:", distinctId.substring(0, 8) + "...");
			}
		});

		isInitialized = true;

		// Track extension metadata as super properties
		posthog.register({
			extension_version: chrome.runtime.getManifest().version,
			environment: import.meta.env.DEV ? "development" : "production"
		});
	} catch (error) {
		console.error("[Analytics] Failed to initialize PostHog:", error);
	}
}

/**
 * Track a custom event
 */
export function trackEvent(eventName: string, properties?: Record<string, any>): void {
	if (!posthog || !isInitialized) {
		if (import.meta.env.DEV) {
			console.log("[Analytics] Event (not sent):", eventName, properties);
		}
		return;
	}

	posthog.capture(eventName, properties);
}

/**
 * Track an error with context
 */
export function trackError(errorName: string, error: Error | unknown, context?: Record<string, any>): void {
	const errorDetails = error instanceof Error ? {
		message: error.message,
		stack: error.stack,
		name: error.name
	} : {
		message: String(error)
	};

	trackEvent("error_occurred", {
		error_name: errorName,
		...errorDetails,
		...context
	});
}

/**
 * Enable debug mode (development only)
 */
export function setDebugMode(enabled: boolean): void {
	if (posthog && import.meta.env.DEV) {
		posthog.debug(enabled);
	}
}
```

### 1.4 Events to Track

#### Extension Lifecycle Events

**Service Worker (`src/background/service-worker.ts`):**
- `extension_installed` - When extension is first installed
- `extension_updated` - When extension is updated to new version
- `sidepanel_opened` - When user opens side panel via toolbar button
- `context_menu_clicked` - When user right-clicks to "Edit on Karl"

#### Side Panel Events

**App.tsx / useSfGovPage.ts:**
- `sidepanel_viewed` - When side panel loads (track page type, domain)
- `page_data_loaded` - Successful page data fetch from Wagtail API
- `page_data_error` - Failed to load page data

#### Feature Usage Events

**EditLinkCard.tsx:**
- `edit_button_clicked` - User clicks "Edit in Karl" button
- `create_page_clicked` - User clicks "Create new page" link

**LinkCheckerCard.tsx:**
- `link_check_started` - User initiates link check
- `link_check_completed` - Link check finishes (track duration, results)
- `link_check_error` - Link check fails
- `link_check_cancelled` - User cancels in-progress check

**FeedbackCard.tsx:**
- `feedback_card_expanded` - User expands feedback section
- `feedback_viewed` - Feedback data loaded successfully
- `feedback_item_clicked` - User clicks individual feedback item

**MediaAssetsCard.tsx:**
- `media_asset_clicked` - User clicks image or document (track type)

**MetadataCard.tsx:**
- `api_link_clicked` - User clicks API documentation link

**FormConfirmationCard.tsx:**
- `form_confirmation_viewed` - User views form confirmation preview

#### Navigation Events

**Service Worker:**
- `tab_changed` - User switches to/from SF.gov tab (track if side panel enabled)

### 1.5 Implementation in Code

#### Background Service Worker

**File: `packages/extension/src/background/service-worker.ts`**

```typescript
import { initAnalytics, trackEvent } from "@/lib/analytics.ts";

// Initialize analytics at startup
initAnalytics();

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
	await initAnalytics();

	if (reason === "install") {
		trackEvent("extension_installed");
	} else if (reason === "update") {
		trackEvent("extension_updated", {
			previous_version: previousVersion,
			new_version: chrome.runtime.getManifest().version
		});
	}

	// ... existing code
});

// Track toolbar button clicks
chrome.action.onClicked.addListener(async (tab) => {
	trackEvent("sidepanel_opened", {
		trigger: "toolbar_button",
		page_url: tab.url
	});
});

// Track context menu usage
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (info.menuItemId === "edit-on-karl") {
		trackEvent("context_menu_clicked", {
			page_url: tab?.url
		});

		// ... existing code
	}
});
```

#### Side Panel App

**File: `packages/extension/src/sidepanel/App.tsx`**

```typescript
import { initAnalytics, trackEvent, trackError } from "@/lib/analytics";
import { useEffect } from "react";

export default function App() {
	const {
		pageData,
		error,
		isLoading,
		isOnSfGov,
		currentUrl,
		// ... other state
	} = useSfGovPage();

	// Initialize analytics
	useEffect(() => {
		initAnalytics();
	}, []);

	// Track side panel views
	useEffect(() => {
		if (isOnSfGov && !isLoading) {
			trackEvent("sidepanel_viewed", {
				is_admin_page: isAdminPage,
				content_type: pageData?.contentType,
				has_data: !!pageData,
				page_url: currentUrl
			});
		}
	}, [isOnSfGov, isLoading, pageData?.contentType, isAdminPage, currentUrl]);

	// Track errors
	useEffect(() => {
		if (error) {
			trackError("sidepanel_load_error", new Error(error.message), {
				error_type: error.type,
				page_url: currentUrl
			});
		}
	}, [error, currentUrl]);

	// ... rest of component
}
```

#### Edit Link Card

**File: `packages/extension/src/sidepanel/components/EditLinkCard.tsx`**

```typescript
import { trackEvent } from "@/lib/analytics";

export function EditLinkCard({ pageId }: { pageId: number }) {
	const handleEditClick = () => {
		trackEvent("edit_button_clicked", {
			page_id: pageId,
			trigger: "sidepanel_button"
		});
	};

	return (
		<Card title="Edit Page">
			<a
				href={`https://api.sf.gov/admin/pages/${pageId}/edit/`}
				target="_blank"
				onClick={handleEditClick}
			>
				<Button>Edit in Karl</Button>
			</a>
		</Card>
	);
}
```

#### Link Checker Card

**File: `packages/extension/src/sidepanel/components/LinkCheckerCard.tsx`**

```typescript
import { trackEvent, trackError } from "@/lib/analytics";

export function LinkCheckerCard({ pageUrl }: { pageUrl: string }) {
	const handleCheckLinks = async () => {
		const startTime = Date.now();

		trackEvent("link_check_started", {
			page_url: pageUrl,
			link_count: links.length
		});

		try {
			// ... existing link check logic

			const duration = Date.now() - startTime;
			trackEvent("link_check_completed", {
				page_url: pageUrl,
				total_links: results.length,
				broken_links: results.filter(r => r.status === "broken").length,
				insecure_links: results.filter(r => r.status === "insecure").length,
				duration_ms: duration
			});
		} catch (error) {
			trackError("link_check_error", error, {
				page_url: pageUrl,
				link_count: links.length
			});
		}
	};

	// ... rest of component
}
```

#### Feedback Card

**File: `packages/extension/src/sidepanel/components/FeedbackCard.tsx`**

```typescript
import { trackEvent } from "@/lib/analytics";

export function FeedbackCard({ pagePath }: { pagePath: string }) {
	const handleExpand = () => {
		trackEvent("feedback_card_expanded", {
			page_path: pagePath,
			feedback_count: feedbackData?.stats.total || 0
		});
	};

	useEffect(() => {
		if (feedbackData) {
			trackEvent("feedback_viewed", {
				page_path: pagePath,
				total_feedback: feedbackData.stats.total,
				helpful_percent: feedbackData.stats.helpfulPercent
			});
		}
	}, [feedbackData, pagePath]);

	// ... rest of component
}
```

### 1.6 Testing

#### Manual Testing Checklist

1. **Install tracking:**
   - [ ] Fresh install triggers `extension_installed` event
   - [ ] Version update triggers `extension_updated` event

2. **Side panel tracking:**
   - [ ] Opening side panel triggers `sidepanel_viewed`
   - [ ] Error states trigger error events

3. **Feature tracking:**
   - [ ] Edit button click tracked
   - [ ] Link checker start/complete tracked
   - [ ] Context menu click tracked
   - [ ] Feedback expansion tracked

4. **Debug mode:**
   - [ ] Events logged to console in development mode
   - [ ] Events sent to PostHog in production

#### Verify in PostHog Dashboard

1. Go to PostHog dashboard → Live events
2. Use the extension and verify events appear
3. Check event properties are captured correctly
4. Verify distinct_id is consistent across contexts

### 1.7 Privacy & Compliance

#### Privacy Policy Update

Add to extension's privacy policy:

```markdown
## Analytics

Karl Jr. collects anonymous usage analytics to understand feature adoption
and improve the extension. This includes:

- Feature usage (which buttons are clicked, which tools are used)
- Error reports (when things break)
- Performance metrics (how long operations take)

We do NOT collect:
- Personal information
- Browsing history
- Page content from SF.gov
- Any data outside the extension's own interface

Analytics data is stored securely by PostHog and is only accessible to
the SF.gov development team.

All tracking is anonymous - we cannot identify individual users.
```

#### Chrome Web Store Listing

When submitting to Chrome Web Store:
- Check "Analytics" in data usage declaration
- Specify "Anonymous usage statistics"
- Link to privacy policy
- No additional permissions needed (storage already declared)

### 1.8 Monitoring & Dashboards

#### Key Metrics to Track

**Engagement Metrics:**
- Daily Active Users (DAU)
- Weekly Active Users (WAU)
- Monthly Active Users (MAU)
- Session duration
- Sessions per user

**Feature Adoption:**
- % users who click Edit button
- % users who use context menu
- % users who run link checker
- % users who expand feedback

**Performance:**
- Link checker average duration
- Error rate by feature
- API call success rate

**Retention:**
- D1, D7, D30 retention cohorts
- User journey funnel (install → first use → return use)

#### PostHog Dashboard Setup

Create dashboards for:

1. **Overview Dashboard:**
   - Total users (MAU/WAU/DAU)
   - Most used features (event counts)
   - Error rate trend

2. **Feature Usage Dashboard:**
   - Events by feature (bar chart)
   - Feature adoption funnel
   - Time to first use of each feature

3. **Health Dashboard:**
   - Error events by type
   - Link check success rate
   - API response times

## Phase 2: Session Replay (Optional)

*Only proceed if Phase 1 event tracking proves insufficient for debugging.*

### 2.1 When to Consider Phase 2[react-tailwind-ui-refactor](../react-tailwind-ui-refactor)

Proceed to session replay if:
- Users report UI bugs that are hard to reproduce
- Event tracking doesn't provide enough context
- Need to see exact user interactions leading to errors
- Want to understand UI confusion points

### 2.2 Implementation Changes

#### Update Analytics Module

```typescript
// Add to packages/extension/src/lib/analytics.ts

export async function initAnalyticsWithReplay(): Promise<void> {
	if (isInitialized) return;

	const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
	if (!apiKey) return;

	// Check if user has enabled session replay
	const { sessionReplayEnabled = false } = await chrome.storage.local.get(['sessionReplayEnabled']);

	// Import recorder only if enabled
	if (sessionReplayEnabled) {
		await import("posthog-js/dist/posthog-recorder");
	}

	const distinctId = await getSharedDistinctId();

	posthog = new PostHog();
	posthog.init(apiKey, {
		api_host: "https://us.i.posthog.com",
		disable_external_dependency_loading: true,
		persistence: "localStorage",
		bootstrap: { distinctID: distinctId },
		autocapture: false,
		capture_pageview: false,
		capture_pageleave: false,
		disable_session_recording: !sessionReplayEnabled,
		session_recording: {
			maskAllInputs: false,
			maskTextSelector: '[data-sensitive]',
			recordCrossOriginIframes: false,
		}
	});

	isInitialized = true;
}
```

#### Add Settings UI

Create a settings card in side panel:

```typescript
// packages/extension/src/sidepanel/components/SettingsCard.tsx

import { useState, useEffect } from "react";
import { Card } from "./Card";

export function SettingsCard() {
	const [replayEnabled, setReplayEnabled] = useState(false);

	useEffect(() => {
		chrome.storage.local.get(['sessionReplayEnabled']).then(({ sessionReplayEnabled }) => {
			setReplayEnabled(sessionReplayEnabled || false);
		});
	}, []);

	const handleToggle = async (enabled: boolean) => {
		await chrome.storage.local.set({ sessionReplayEnabled: enabled });
		setReplayEnabled(enabled);

		// Notify user that they need to reload extension
		alert("Extension needs to reload for changes to take effect. Please close and reopen the side panel.");
	};

	return (
		<Card title="Settings">
			<label className="flex items-center gap-2">
				<input
					type="checkbox"
					checked={replayEnabled}
					onChange={(e) => handleToggle(e.target.checked)}
				/>
				<span className="text-sm">
					Enable session recording for debugging
					<span className="block text-xs text-gray-500">
						Helps us fix bugs by showing what happened in the extension UI
					</span>
				</span>
			</label>
		</Card>
	);
}
```

### 2.3 Updated Privacy Policy

Add to privacy policy:

```markdown
### Session Recording (Optional)

Users can optionally enable session recording to help debug issues.
When enabled, we record:
- Mouse movements and clicks within the extension UI only
- UI state changes and interactions

We do NOT record:
- Content on SF.gov pages
- Keyboard input (for security)
- Any activity outside the extension

Session recordings are stored securely and automatically deleted after 30 days.
```

### 2.4 Testing Session Replay

1. Enable session recording in extension settings
2. Interact with various features
3. Check PostHog → Session Replay to view recording
4. Verify only extension UI is captured
5. Confirm SF.gov page content is NOT visible

## Success Criteria

### Phase 1 Success Metrics

- [ ] Analytics integrated without errors
- [ ] All core events tracked correctly
- [ ] PostHog dashboard shows real-time data
- [ ] No Chrome Web Store compliance issues
- [ ] Can answer: "Which features are most used?"
- [ ] Can answer: "How many active users do we have?"
- [ ] Can answer: "What errors are users encountering?"

### Phase 2 Success Metrics (if needed)

- [ ] Session replay captures extension UI
- [ ] Does NOT capture SF.gov page content
- [ ] Helps reproduce and fix reported bugs
- [ ] Users understand and can control recording
- [ ] No privacy concerns from internal users

## Timeline Estimate

**Phase 1:**
- Setup & configuration: 1 hour
- Analytics module creation: 1-2 hours
- Event instrumentation: 2-3 hours
- Testing & verification: 1-2 hours
- Total: 5-8 hours

**Phase 2 (if needed):**
- Update analytics module: 1 hour
- Add settings UI: 1-2 hours
- Testing: 1 hour
- Total: 3-4 hours

## Rollout Plan

1. **Development:** Implement Phase 1 in development environment
2. **Internal Testing:** Test with 3-5 internal users for 1 week
3. **Beta Release:** Deploy to all users with Phase 1 tracking
4. **Monitor:** Review analytics for 2-4 weeks
5. **Evaluate:** Decide if Phase 2 is needed based on:
   - Bug report frequency
   - Reproducibility of issues
   - Adequacy of event tracking
6. **Phase 2 (Optional):** Implement session replay if needed
