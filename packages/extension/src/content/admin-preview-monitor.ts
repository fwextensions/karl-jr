// content script for monitoring Wagtail admin preview button
// injected into api.sf.gov/admin/* pages to detect and track preview URLs

interface PreviewButtonState {
	href: string | null;
	isDisabled: boolean;
	exists: boolean;
}

interface PreviewMessage {
	type: "PREVIEW_URL_UPDATE" | "PREVIEW_UNAVAILABLE";
	url?: string;
	timestamp: number;
}

// constants
const PREVIEW_BUTTON_SELECTOR = "[data-controller=\"preview-button\"]";
const MAX_DETECTION_TIME = 5000; // 5 seconds
const DEBOUNCE_DELAY = 100; // 100ms
const RETRY_INTERVALS = [100, 250, 500, 1000, 2000]; // exponential backoff

// state
let observer: MutationObserver | null = null;
let debounceTimer: number | null = null;
let lastSentHref: string | null = null;

/**
 * detect preview button with retry logic
 * attempts to find the button with exponential backoff up to MAX_DETECTION_TIME
 */
async function detectPreviewButton(): Promise<HTMLElement | null> {
	const startTime = Date.now();
	let attemptIndex = 0;

	while (Date.now() - startTime < MAX_DETECTION_TIME) {
		const button = document.querySelector(PREVIEW_BUTTON_SELECTOR) as HTMLElement | null;
		
		if (button) {
			console.log("[admin-preview-monitor] preview button detected");
			return button;
		}

		// wait before next attempt
		const delay = RETRY_INTERVALS[Math.min(attemptIndex, RETRY_INTERVALS.length - 1)];
		await new Promise(resolve => setTimeout(resolve, delay));
		attemptIndex++;
	}

	console.warn("[admin-preview-monitor] preview button not found after", MAX_DETECTION_TIME, "ms");
	return null;
}

/**
 * extract current state from preview button element
 */
function getButtonState(button: HTMLElement): PreviewButtonState {
	const href = button.getAttribute("href");
	const isDisabled = button.classList.contains("disabled") || 
	                   button.hasAttribute("disabled") ||
	                   button.getAttribute("aria-disabled") === "true";

	return {
		href,
		isDisabled,
		exists: true,
	};
}

/**
 * send message to extension runtime with retry logic
 */
async function sendMessage(message: PreviewMessage, retryCount = 0): Promise<void> {
	try {
		await chrome.runtime.sendMessage(message);
		console.log("[admin-preview-monitor] message sent:", message.type, message.url || "");
	} catch (error) {
		console.error("[admin-preview-monitor] failed to send message:", error);
		
		// retry once after 1 second
		if (retryCount === 0) {
			console.log("[admin-preview-monitor] retrying message send in 1s");
			await new Promise(resolve => setTimeout(resolve, 1000));
			await sendMessage(message, retryCount + 1);
		}
	}
}

/**
 * send PREVIEW_URL_UPDATE message
 */
function sendPreviewUrlUpdate(url: string): void {
	const message: PreviewMessage = {
		type: "PREVIEW_URL_UPDATE",
		url,
		timestamp: Date.now(),
	};
	sendMessage(message);
	lastSentHref = url;
}

/**
 * send PREVIEW_UNAVAILABLE message
 */
function sendPreviewUnavailable(): void {
	const message: PreviewMessage = {
		type: "PREVIEW_UNAVAILABLE",
		timestamp: Date.now(),
	};
	sendMessage(message);
	lastSentHref = null;
}

/**
 * handle button state changes with debouncing
 */
function handleButtonChange(button: HTMLElement): void {
	// clear existing debounce timer
	if (debounceTimer !== null) {
		clearTimeout(debounceTimer);
	}

	// debounce the change handler
	debounceTimer = window.setTimeout(() => {
		const state = getButtonState(button);
		
		console.log("[admin-preview-monitor] button state changed:", {
			href: state.href,
			isDisabled: state.isDisabled,
		});

		// check if button is disabled
		if (state.isDisabled) {
			if (lastSentHref !== null) {
				sendPreviewUnavailable();
			}
			return;
		}

		// check if href is valid and changed
		if (state.href && state.href !== lastSentHref) {
			sendPreviewUrlUpdate(state.href);
		}
	}, DEBOUNCE_DELAY);
}

/**
 * setup MutationObserver to watch preview button
 */
function setupObserver(button: HTMLElement): void {
	observer = new MutationObserver((mutations) => {
		// check if any relevant attributes changed
		const hasRelevantChange = mutations.some(mutation => {
			return mutation.type === "attributes" && 
			       (mutation.attributeName === "href" || mutation.attributeName === "class");
		});

		if (hasRelevantChange) {
			handleButtonChange(button);
		}
	});

	// observe href and class attributes
	observer.observe(button, {
		attributes: true,
		attributeFilter: ["href", "class"],
		subtree: false,
	});

	console.log("[admin-preview-monitor] MutationObserver setup complete");

	// send initial state
	const initialState = getButtonState(button);
	if (!initialState.isDisabled && initialState.href) {
		sendPreviewUrlUpdate(initialState.href);
	} else if (initialState.isDisabled) {
		sendPreviewUnavailable();
	}
}

/**
 * cleanup function to disconnect observer and clear timers
 */
function cleanup(): void {
	console.log("[admin-preview-monitor] cleaning up resources");

	if (observer) {
		observer.disconnect();
		observer = null;
	}

	if (debounceTimer !== null) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}

	lastSentHref = null;
}

/**
 * get current preview state
 * returns the current preview URL if available
 */
function getCurrentPreviewState(): void {
	console.log("[admin-preview-monitor] current preview state requested");
	
	const button = document.querySelector(PREVIEW_BUTTON_SELECTOR) as HTMLElement | null;
	
	if (!button) {
		console.log("[admin-preview-monitor] no preview button found");
		sendPreviewUnavailable();
		return;
	}
	
	const state = getButtonState(button);
	
	if (!state.isDisabled && state.href) {
		console.log("[admin-preview-monitor] sending current preview URL:", state.href);
		sendPreviewUrlUpdate(state.href);
	} else {
		console.log("[admin-preview-monitor] preview button is disabled");
		sendPreviewUnavailable();
	}
}

/**
 * initialize the content script
 */
async function initialize(): Promise<void> {
	console.log("[admin-preview-monitor] initializing on", window.location.href);

	// detect preview button
	const button = await detectPreviewButton();

	if (!button) {
		sendPreviewUnavailable();
		return;
	}

	// setup observer
	setupObserver(button);

	// add cleanup listener for page unload
	window.addEventListener("beforeunload", cleanup);
}

/**
 * listen for messages from side panel requesting current state
 */
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
	if (message.type === "REQUEST_PREVIEW_STATE") {
		console.log("[admin-preview-monitor] received preview state request");
		getCurrentPreviewState();
	}
});

// start monitoring when script loads
initialize();
