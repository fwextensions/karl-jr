/**
 * Background Service Worker
 * Handles toolbar button clicks to toggle the side panel
 * Forwards messages from content scripts to side panel
 */

import { extractPageSlug } from "@/lib/urlUtils.ts";
import { findPageBySlug } from "@/api/wagtail-client.ts";
import { initAnalytics, trackEvent, trackError } from "@/lib/analytics.ts";

// Add hostnames to exclude here, e.g.:
const EXCLUDED_HOSTNAMES: string[] = [
	"api.sf.gov"
];

/**
 * Check if a URL matches the SF.gov domain pattern (*.sf.gov or *.staging.dev.sf.gov)
 * @param url - The URL to check
 * @returns true if the URL matches *.sf.gov or staging, false otherwise
 */
function isSfGovDomain(url: string): boolean {
	try {
		const urlObj = new URL(url);
		const hostname = urlObj.hostname.toLowerCase();
		
		// check if hostname is exactly sf.gov or ends with .sf.gov (including staging)
		return hostname === "sf.gov" || hostname.endsWith(".sf.gov");
	} catch (err) {
		// URL parsing failed (e.g., chrome://, about:blank, invalid URLs)
		// treat as non-SF.gov domain
		return false;
	}
}

/**
 * Update side panel visibility for a specific tab based on its URL
 * @param tabId - The Chrome tab ID
 * @param url - The tab's current URL
 */
async function updateSidePanelForTab(tabId: number, url: string): Promise<void> {
	try {
		const isSfGov = isSfGovDomain(url);
		
		if (isSfGov) {
			// enable side panel for SF.gov domains
			await chrome.sidePanel.setOptions({
				tabId,
				enabled: true,
				path: "src/sidepanel/index.html",
			});
		} else {
			// disable side panel for non-SF.gov domains
			await chrome.sidePanel.setOptions({
				tabId,
				enabled: false,
			});
		}
	} catch (err) {
		console.error(`Side panel update error for tab ${tabId}:`, err);
	}
}

/**
 * Update context menu visibility based on the URL
 * Can't use negative lookups in documentUrlPatterns, so we handle it here
 */
async function updateContextMenuVisibility(url: string): Promise<void> {
	try {
		const urlObj = new URL(url);
		const isExcluded = EXCLUDED_HOSTNAMES.includes(urlObj.hostname);
		
		// Update the menu item visibility
		// Note: This affects the menu globally, but since we update it on tab activation/update,
		// it effectively works per-tab for the active user.
		await chrome.contextMenus.update("edit-on-karl", {
			visible: !isExcluded
		});
	} catch (err) {
		// Ignore errors (e.g. if menu item doesn't exist yet or invalid URL)
	}
}

/**
 * Set up event listeners when the service worker is installed
 */
chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
	// initialize analytics
	await initAnalytics();

	// track install or update
	if (reason === "install") {
		trackEvent("extension_installed");
	} else if (reason === "update") {
		trackEvent("extension_updated", {
			previous_version: previousVersion,
			new_version: chrome.runtime.getManifest().version
		});
	}

	// disable side panel by default for all tabs
	void chrome.sidePanel.setOptions({ enabled: false });

	void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
	console.log("SF.gov Companion installed");

  // Create a menu item that appears when right-clicking anywhere on the page
  // BUT only on URLs matching the specified pattern
	chrome.contextMenus.removeAll(() => {
		chrome.contextMenus.create({
			id: "edit-on-karl",
			title: "Edit on Karl",
			contexts: ["page", "action"], // "page" for right-click on the page, "action" for the icon
			documentUrlPatterns: [
				"https://*.sf.gov/*",
				"http://*.sf.gov/*"
			]
		});
	});

	// check all existing tabs and enable side panel for sf.gov domains
	try {
		const tabs = await chrome.tabs.query({});
		for (const tab of tabs) {
			if (tab.id && tab.url) {
				await updateSidePanelForTab(tab.id, tab.url);
				await updateContextMenuVisibility(tab.url);
			}
		}
	} catch (err) {
		console.error("Error updating existing tabs on install:", err);
	}
});

// Add a listener for when the menu item is clicked
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "edit-on-karl") {
    if (tab?.url && isSfGovDomain(tab.url)) {
			const { url } = tab;

			// Double-check exclusion list
			try {
				const urlObj = new URL(url);
				if (EXCLUDED_HOSTNAMES.includes(urlObj.hostname)) return;
			} catch (e) { /* ignore */ }

      console.log("==== edit", url);

			// track context menu usage
			trackEvent("context_menu_clicked", {
				page_url: url
			});

			try {
				const slug = extractPageSlug(url);
				const data = await findPageBySlug(slug);

				if (data) {
					const editUrl = `https://api.sf.gov/admin/pages/${data.id}/edit/`;

					await chrome.tabs.create({ url: editUrl });
				}
			} catch (e) {
				console.error(e);
				trackError("context_menu_page_lookup_failed", e as Error, {
					page_url: url
				});
			}
    }
  }
});

/**
 * Listen for tab activation events (user switches tabs)
 */
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
	try {
		let tab;

			// try to get the tab, but ignore errors, since this will throw if the tab
			// doesn't exist, annoyingly
		try { tab = await chrome.tabs.get(tabId); } catch (err) {}

		if (!tab?.url) return;

		await updateSidePanelForTab(tabId, tab.url);
		await updateContextMenuVisibility(tab.url);
	} catch (err) {
		console.error("Side panel activation handling error:", err);
	}
});

/**
 * Listen for tab update events (URL changes within a tab)
 */
chrome.tabs.onUpdated.addListener(async (tabId, _changeInfo, tab) => {
	if (!tab.url) return;
	
	try {
		await updateSidePanelForTab(tabId, tab.url);
		await updateContextMenuVisibility(tab.url);
	} catch (err) {
		console.error("Side panel update handling error:", err);
	}
});

/**
 * Listen for messages from content script and forward to side panel
 */
chrome.runtime.onMessage.addListener((message, sender) => {
	// only process messages from content scripts
	if (!sender.tab) {
		return;
	}

	// forward preview messages and page data extraction messages to side panel
	if (
		message.type === "PREVIEW_URL_UPDATE" ||
		message.type === "PREVIEW_UNAVAILABLE" ||
		message.type === "PAGE_DATA_EXTRACTED" ||
		message.type === "PAGE_DATA_EXTRACTION_FAILED"
	) {
		console.log(`Forwarding message from tab ${sender.tab.id}:`, message.type);
		
		// forward to side panel (all extension contexts will receive this)
		// note: this will fail silently if side panel is not open, which is expected
		chrome.runtime.sendMessage(message).catch(() => {
			// side panel not open, message will be ignored
		});
	}
});
