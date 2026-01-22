export interface LinkInfo {
	url: string;
	text: string;
}

export interface LinkCheckResult {
	url: string;
	text: string;
	status: "ok" | "broken" | "redirect" | "timeout" | "error" | "insecure" | "unverifiable";
	statusCode?: number;
	error?: string;
}

/**
 * Checks a single link using a HEAD request.
 * This function is designed to be injected into the page context where it has
 * same-origin privileges and avoids CORS issues.
 * NOTE: This function must be self-contained since it's injected via chrome.scripting.executeScript
 */
export async function checkLinkInPage(url: string): Promise<{ status: "ok" | "broken" | "redirect" | "timeout" | "error" | "insecure" | "unverifiable"; statusCode?: number; error?: string }>
{
	// domains that should always be considered valid, even if they return 404 without proper auth
	const ALWAYS_VALID_DOMAINS = [
		"twitter.com",
		"x.com",
	];

	// check if URL is from an always-valid domain
	try {
		const urlObj = new URL(url);
		const hostname = urlObj.hostname.toLowerCase();

		if (ALWAYS_VALID_DOMAINS.some((domain) =>
			hostname === domain || hostname.endsWith(`.${domain}`)
		)) {
			return { status: "ok" };
		}
	} catch {
		// if URL parsing fails, continue with normal checking
	}

	async function doFetch(fetchUrl: string): Promise<{ status: "ok" | "broken" | "redirect" | "timeout" | "error" | "unverifiable"; statusCode?: number; error?: string }>
	{
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 10000);

			// normalize sf.gov URLs to match current page origin to avoid CORS issues
			// e.g., if on www.sf.gov, convert sf.gov links to www.sf.gov
			let normalizedUrl = fetchUrl;
			const currentOrigin = window.location.origin;
			const urlObj = new URL(fetchUrl);

			// handle sf.gov <-> www.sf.gov mismatch
			if (currentOrigin === "https://www.sf.gov" && urlObj.origin === "https://sf.gov") {
				urlObj.hostname = "www.sf.gov";
				normalizedUrl = urlObj.href;
			} else if (currentOrigin === "https://sf.gov" && urlObj.origin === "https://www.sf.gov") {
				urlObj.hostname = "sf.gov";
				normalizedUrl = urlObj.href;
			}

			let response: Response;
			let wasRedirected = false;

			// try CORS mode with follow - this lets browser handle redirects
			// and we can see the final status code
			try {
				response = await fetch(normalizedUrl, {
					method: "HEAD",
					signal: controller.signal,
					redirect: "follow",
					mode: "cors",
				});
				// check if we were redirected by comparing URLs
				wasRedirected = response.url !== normalizedUrl;
			} catch (corsErr) {
				// CORS failed, fall back to no-cors
				try {
					response = await fetch(normalizedUrl, {
						method: "HEAD",
						signal: controller.signal,
						redirect: "follow",
						mode: "no-cors",
					});
				} catch (noCorsErr) {
					// both CORS and no-cors failed - truly unverifiable
					return { status: "unverifiable", error: "Failed to fetch" };
				}
			}

			clearTimeout(timeoutId);

			// with no-cors mode, we get an opaque response - can't see status
			// if no-cors succeeded, treat as ok (site is working, just has CORS restrictions)
			if (response.type === "opaque") {
				return { status: "ok" };
			}

			const statusCode = response.status;

			// with redirect: "follow", we get the final destination's status
			if (statusCode >= 200 && statusCode < 300) {
				// if we were redirected, report as redirect (but destination is ok)
				if (wasRedirected) {
					return { status: "redirect", statusCode };
				}
				return { status: "ok", statusCode };
			}

			// 4xx or 5xx = broken link
			return { status: "broken", statusCode };
		} catch (err) {
			if (err instanceof Error) {
				if (err.name === "AbortError") {
					return { status: "timeout", error: "Request timed out" };
				}
				// CORS/CORP errors and other fetch failures - site may be working but unverifiable
				return { status: "unverifiable", error: err.message };
			}
			return { status: "unverifiable", error: "Unknown error" };
		}
	}

	// check if this is an http link on an https page (mixed content)
	const isHttpLink = url.startsWith("http://");
	const isHttpsPage = window.location.protocol === "https:";

	if (isHttpLink && isHttpsPage) {
		// always flag http links on https pages, even if https version works
		return { status: "insecure", error: "HTTP link on HTTPS page" };
	}

	return doFetch(url);
}

/**
 * Extracts all links from the <main> content area of the page.
 * This function is designed to be injected into the page context.
 */
export function extractContentLinks(): LinkInfo[]
{
	const main = document.querySelector("main");
	if (!main) {
		return [];
	}

	const links = main.querySelectorAll("a[href]");
	const seen = new Set<string>();
	const results: LinkInfo[] = [];

	links.forEach((link) => {
		const anchor = link as HTMLAnchorElement;
		const href = anchor.href;

		// skip empty, javascript:, mailto:, tel: links
		if (!href ||
			href.startsWith("javascript:") ||
			href.startsWith("mailto:") ||
			href.startsWith("tel:") ||
			href.startsWith("#")
		) {
			return;
		}

		// deduplicate
		if (seen.has(href)) {
			return;
		}
		seen.add(href);

		results.push({
			url: href,
			text: anchor.textContent?.trim() || "",
		});
	});

	return results;
}

/**
 * Extracts all PDF links from the page.
 * This function is designed to be injected into the page context.
 */
export function extractPdfLinks(): LinkInfo[]
{
	const links = document.querySelectorAll("a[href]");
	const seen = new Set<string>();
	const results: LinkInfo[] = [];

	links.forEach((link) => {
		const anchor = link as HTMLAnchorElement;
		const href = anchor.href;

		// check if the link points to a PDF file
		if (!href || !href.toLowerCase().endsWith(".pdf")) {
			return;
		}

		// deduplicate
		if (seen.has(href)) {
			return;
		}
		seen.add(href);

		results.push({
			url: href,
			text: anchor.textContent?.trim() || "",
		});
	});

	return results;
}

export interface CategorizedLinks {
	pdfs: LinkInfo[];
	otherFiles: LinkInfo[];
	external: LinkInfo[];
	internal: LinkInfo[];
}

/**
 * Extracts and categorizes all links from the <main> content area of the page.
 * This function is designed to be injected into the page context.
 */
export function extractCategorizedLinks(): CategorizedLinks
{
	const results: CategorizedLinks = {
		pdfs: [],
		otherFiles: [],
		external: [],
		internal: [],
	};
	const main = document.querySelector("main");

	if (!main) {
		return results;
	}

	const links = main.querySelectorAll("a[href]");
	const seen = new Set<string>();
	const currentHostname = window.location.hostname;
	const fileExtensions = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip", ".csv", ".txt", ".rtf"];

	// helper to get base domain (e.g., "sf.gov" from "www.sf.gov" or "api.sf.gov")
	const getBaseDomain = (hostname: string): string => {
		const parts = hostname.split(".");
		// if hostname has at least 2 parts, return last 2 (e.g., "sf.gov")
		if (parts.length >= 2) {
			return parts.slice(-2).join(".");
		}
		return hostname;
	};

	const currentBaseDomain = getBaseDomain(currentHostname);

	links.forEach((link) => {
		const anchor = link as HTMLAnchorElement;
		const href = anchor.href;

		// skip empty, javascript:, mailto:, tel: links
		if (!href ||
			href.startsWith("javascript:") ||
			href.startsWith("mailto:") ||
			href.startsWith("tel:") ||
			href.startsWith("#")
		) {
			return;
		}

		// deduplicate
		if (seen.has(href)) {
			return;
		}
		seen.add(href);

		const linkInfo: LinkInfo = {
			url: href,
			text: anchor.textContent?.trim() || "",
		};

		const lowerHref = href.toLowerCase();

		// categorize PDFs
		if (lowerHref.endsWith(".pdf")) {
			results.pdfs.push(linkInfo);
			return;
		}

		// categorize other file types
		if (fileExtensions.some(ext => lowerHref.endsWith(ext))) {
			results.otherFiles.push(linkInfo);
			return;
		}

		// categorize external vs internal
		try {
			const linkUrl = new URL(href);
			const linkBaseDomain = getBaseDomain(linkUrl.hostname);
			if (linkBaseDomain === currentBaseDomain) {
				results.internal.push(linkInfo);
			} else {
				results.external.push(linkInfo);
			}
		} catch {
			// if URL parsing fails, treat as internal
			results.internal.push(linkInfo);
		}
	});

	return results;
}
