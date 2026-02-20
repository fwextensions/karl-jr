import "posthog-js/dist/surveys";
import "posthog-js/dist/exception-autocapture";
import { PostHog } from "posthog-js/dist/module.no-external";
import { v7 as uuidv7 } from "uuid";

let posthog: PostHog | null = null;
let isInitialized = false;

// debounce mechanism to prevent duplicate events
const recentEvents = new Map<string, number>();
const DEBOUNCE_WINDOW = 100; // 100ms window to catch duplicates from React strict mode

/**
 * Get or create a device ID across all extension contexts
 * Uses chrome.storage.local since it's available in both service worker and side panel
 */
async function getDeviceId(): Promise<string> {
	const result = await chrome.storage.local.get("posthogDeviceID");
	const stored = result.posthogDeviceID as string | undefined;

	if (stored) {
		return stored;
	}

	const id = uuidv7();

	await chrome.storage.local.set({ posthogDeviceID: id });

	return id;
}

/**
 * Initialize PostHog analytics
 * Safe to call multiple times - will only initialize once
 */
export async function initAnalytics(): Promise<void> {
	if (isInitialized) {
		console.log("[Analytics] Already initialized, skipping");
		return;
	}

	const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
	console.log("[Analytics] Attempting to initialize PostHog...");
	console.log("[Analytics] API key present:", !!apiKey);

	if (!apiKey) {
		console.warn("[Analytics] PostHog disabled: no API key provided");
		console.log("[Analytics] Available env vars:", Object.keys(import.meta.env));
		return;
	}

	try {
		const deviceId = await getDeviceId();
		console.log("[Analytics] Got device ID:", deviceId.substring(0, 8) + "...");

		posthog = new PostHog();
		posthog.init(apiKey, {
			api_host: "https://us.i.posthog.com",
			disable_external_dependency_loading: true,
			persistence: "memory",
			bootstrap: { distinctID: deviceId },
			autocapture: false,
			capture_pageview: false,
			capture_pageleave: false,
			loaded: () => {
				console.log("[Analytics] ✓ PostHog successfully initialized!");
				console.log("[Analytics] Device ID:", deviceId.substring(0, 8) + "...");
			}
		});

		isInitialized = true;
		console.log("[Analytics] Initialization complete, isInitialized:", isInitialized);

		// track extension metadata as super properties
		posthog.register({
			extension_version: chrome.runtime.getManifest().version,
			environment: import.meta.env.DEV ? "development" : "production",
			device_id: deviceId
		});

		console.log("[Analytics] Super properties registered");
	} catch (error) {
		console.error("[Analytics] Failed to initialize PostHog:", error);
	}
}

/**
 * Track a custom event with automatic deduplication
 * Events with the same name and properties within 100ms are considered duplicates
 */
export function trackEvent(eventName: string, properties?: Record<string, any>): void {
	console.log("[Analytics] trackEvent called:", eventName, properties);
	console.log("[Analytics] posthog exists:", !!posthog);
	console.log("[Analytics] isInitialized:", isInitialized);

	if (!posthog || !isInitialized) {
		if (import.meta.env.DEV) {
			console.warn("[Analytics] Event not sent (not initialized):", eventName, properties);
		}
		return;
	}

	// create a unique key for this event based on name and properties
	const eventKey = `${eventName}:${JSON.stringify(properties || {})}`;
	const now = Date.now();
	const lastEventTime = recentEvents.get(eventKey);

	// check if this is a duplicate within the debounce window
	if (lastEventTime && now - lastEventTime < DEBOUNCE_WINDOW) {
		console.log("[Analytics] ⚠ Duplicate event ignored:", eventName, `(${now - lastEventTime}ms since last)`);
		return;
	}

	// track this event and update timestamp
	recentEvents.set(eventKey, now);

	// clean up old entries periodically to prevent memory leak
	if (recentEvents.size > 100) {
		const cutoff = now - DEBOUNCE_WINDOW * 2;
		for (const [key, timestamp] of recentEvents.entries()) {
			if (timestamp < cutoff) {
				recentEvents.delete(key);
			}
		}
	}

	console.log("[Analytics] ✓ Sending event:", eventName);
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
