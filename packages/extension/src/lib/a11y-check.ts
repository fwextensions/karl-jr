// accessibility check utilities

export interface HeadingNestingIssue {
	fromLevel: number;
	toLevel: number;
	fromText: string;
	toText: string;
	toElement: HTMLElement;
}

/**
 * extract all headings from the page and check for improper nesting
 * this function runs in the page context via chrome.scripting.executeScript
 */
export function checkHeadingNesting(): HeadingNestingIssue[] {
	const allHeadings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
	
	// filter out hidden headings
	const visibleHeadings = allHeadings.filter(heading => {
		const element = heading as HTMLElement;
		
		// check if element or any parent is hidden
		let currentElement: HTMLElement | null = element;
		while (currentElement) {
			const computedStyle = window.getComputedStyle(currentElement);
			
			// check if element is hidden via CSS
			if (computedStyle.display === "none" || 
				computedStyle.visibility === "hidden") {
				return false;
			}
			
			// check for opacity (but allow partial opacity)
			if (parseFloat(computedStyle.opacity) === 0) {
				return false;
			}
			
			// check for clip or clip-path that hides content
			if (computedStyle.clip === "rect(0px, 0px, 0px, 0px)" ||
				computedStyle.clipPath === "inset(100%)") {
				return false;
			}
			
			// move to parent element
			currentElement = currentElement.parentElement;
		}
		
		// check if element has zero dimensions (effectively hidden)
		const rect = element.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) {
			return false;
		}
		
		// check if element is positioned off-screen (common screen reader technique)
		if (rect.left < -9999 || rect.top < -9999 || rect.right < 0 || rect.bottom < 0) {
			return false;
		}
		
		// check for aria-hidden attribute
		if (element.getAttribute("aria-hidden") === "true") {
			return false;
		}
		
		// check for hidden attribute
		if (element.hasAttribute("hidden")) {
			return false;
		}
		
		return true;
	});

	const issues: HeadingNestingIssue[] = [];

	for (let i = 1; i < visibleHeadings.length; i++) {
		const prevHeading = visibleHeadings[i - 1];
		const currHeading = visibleHeadings[i];

		const prevLevel = parseInt(prevHeading.tagName.substring(1));
		const currLevel = parseInt(currHeading.tagName.substring(1));

		// check if heading level jumps by more than 1 (e.g., H2 to H4)
		if (currLevel > prevLevel + 1) {
			issues.push({
				fromLevel: prevLevel,
				toLevel: currLevel,
				fromText: prevHeading.textContent?.trim() || "",
				toText: currHeading.textContent?.trim() || "",
				toElement: currHeading as HTMLElement,
			});
		}
	}

	return issues;
}

export interface ImageAltTextInfo {
	url: string;
	hasAltText: boolean;
	altText: string;
	filename: string;
}

/**
 * check all images on the page for missing alt text
 * this function runs in the page context via chrome.scripting.executeScript
 */
export function checkImageAltText(): ImageAltTextInfo[] {
	const images = Array.from(document.querySelectorAll("img"));
	
	// exclude images in header and footer
	return images
		.filter(img => {
			const inHeader = img.closest("header") !== null;
			const inFooter = img.closest("footer") !== null;
			return !inHeader && !inFooter;
		})
		.map(img => {
			const alt = img.getAttribute("alt");
			const url = img.src;
			
			// extract filename from URL
			let filename = "";
			try {
				const urlPath = new URL(url).pathname;
				filename = urlPath.split("/").pop() || "";
			} catch {
				filename = "";
			}
			
			return {
				url,
				hasAltText: alt !== null && alt.trim() !== "",
				altText: alt || "",
				filename,
			};
		});
}

export interface TableAccessibilityIssue {
	missingCaption: boolean;
	missingHeaders: boolean;
	tableIndex: number;
}

export interface TableAccessibilityResults {
	totalTables: number;
	issues: TableAccessibilityIssue[];
}

export interface VideoAccessibilityIssue {
	videoIndex: number;
	videoSrc: string;
	missingCaptions: boolean;
	missingTranscript: boolean;
}

export interface VideoAccessibilityResults {
	totalVideos: number;
	issues: VideoAccessibilityIssue[];
}

/**
 * check all videos on the page for accessibility requirements
 * this function runs in the page context via chrome.scripting.executeScript
 *
 * all helper functions are inlined because executeScript serializes only
 * the target function — module-level helpers are not available at runtime
 *
 * for captions, checks:
 * - <track> elements with kind="captions" or kind="subtitles"
 * - CC/closed captions toggle button within the video player
 * - YouTube cc_load_policy parameter
 *
 * for transcripts, checks:
 * - "Show transcript" or similar toggle link/button near the video
 * - transcript content or elements with transcript-related classes/IDs
 * - text containing "transcript" keyword in the video's container
 */
export function checkVideoAccessibility(): VideoAccessibilityResults {
	// check if a video player container has a CC/closed captions toggle button
	const hasCaptionToggle = (container: Element): boolean => {
		const candidates = Array.from(container.querySelectorAll(
			"button, [role='button'], [class*='caption'], [class*='cc'], [class*='subtitle'], [aria-label*='caption'], [aria-label*='Caption'], [aria-label*='CC'], [aria-label*='subtitle'], [aria-label*='Subtitle'], [title*='caption'], [title*='Caption'], [title*='CC'], [title*='subtitle'], [title*='Subtitle']"
		));

		for (const el of candidates) {
			const text = (el.textContent || "").trim().toLowerCase();
			const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
			const title = (el.getAttribute("title") || "").toLowerCase();
			const className = (el.getAttribute("class") || "").toLowerCase();

			if (
				text === "cc" ||
				text === "closed captions" ||
				text === "captions" ||
				text === "subtitles" ||
				ariaLabel.includes("caption") ||
				ariaLabel.includes("subtitle") ||
				ariaLabel.includes("closed caption") ||
				title.includes("caption") ||
				title.includes("subtitle") ||
				className.includes("captions-button") ||
				className.includes("cc-button") ||
				className.includes("subtitles-button")
			) {
				return true;
			}
		}

		return false;
	};

	// check whether a transcript toggle's associated content area has real text.
	// the toggle might exist as part of a CMS template even when no transcript
	// was provided, so we need to verify actual content is present.
	//
	// returns true if content is found, or if we can't determine either way
	// (benefit of the doubt).  Only returns false when we can positively
	// confirm the content area is empty.
	const hasTranscriptContent = (toggleEl: Element): boolean => {
		// strategy 1: check if the toggle controls a specific element via
		// aria-controls, href fragment, or data-target
		const controlsId = toggleEl.getAttribute("aria-controls")
			|| (toggleEl.getAttribute("href") || "").replace(/^#/, "")
			|| (toggleEl.getAttribute("data-target") || "").replace(/^#/, "");

		if (controlsId) {
			const controlled = document.getElementById(controlsId);
			if (controlled) {
				const text = (controlled.textContent || "").trim();
				// positively confirmed: content area exists and is empty
				if (text.length === 0) return false;
				return true;
			}
		}

		// strategy 2: look for sibling elements with transcript-related
		// class/id that we can check for emptiness
		const siblings = toggleEl.parentElement
			? Array.from(toggleEl.parentElement.children)
			: [];

		for (const sibling of siblings) {
			if (sibling === toggleEl) continue;
			const cls = (sibling.getAttribute("class") || "").toLowerCase();
			const id = (sibling.getAttribute("id") || "").toLowerCase();

			if (cls.includes("transcript") || id.includes("transcript")) {
				const tag = sibling.tagName.toLowerCase();
				// skip links and buttons — those are other toggles
				if (tag === "a" || tag === "button") continue;
				const text = (sibling.textContent || "").trim();
				// positively confirmed: transcript area exists and is empty
				if (text.length === 0) return false;
				return true;
			}
		}

		// can't determine — give benefit of the doubt since the toggle exists
		return true;
	};

	// check if a transcript link or toggle exists near a video element
	// and that it points to actual transcript content
	const hasTranscriptToggle = (videoEl: Element): boolean => {
		const searchContainers: Element[] = [];

		if (videoEl.parentElement) {
			searchContainers.push(videoEl.parentElement);
		}

		const wrapper = videoEl.parentElement?.closest("div, section, article, figure");
		if (wrapper) {
			searchContainers.push(wrapper);
		}

		// also check the wrapper's parent for cases where the toggle is a sibling
		if (wrapper?.parentElement) {
			searchContainers.push(wrapper.parentElement);
		}

		for (const container of searchContainers) {
			const clickables = Array.from(container.querySelectorAll(
				"a, button, [role='button'], [class*='transcript'], [id*='transcript']"
			));

			for (const el of clickables) {
				const text = (el.textContent || "").trim().toLowerCase();
				const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
				const title = (el.getAttribute("title") || "").toLowerCase();
				const className = (el.getAttribute("class") || "").toLowerCase();
				const id = (el.getAttribute("id") || "").toLowerCase();

				const isTranscriptToggle =
					text.includes("transcript") ||
					text.includes("show transcript") ||
					text.includes("view transcript") ||
					text.includes("video transcript") ||
					ariaLabel.includes("transcript") ||
					title.includes("transcript") ||
					className.includes("transcript") ||
					id.includes("transcript");

				if (isTranscriptToggle) {
					// found a toggle — but does it have real content behind it?
					if (hasTranscriptContent(el)) {
						return true;
					}
					// toggle exists but no content — keep searching other
					// containers in case the content is further up the DOM
				}
			}

			// also check for static transcript content (already visible)
			const transcriptElements = container.querySelectorAll(
				"[class*='transcript'], [id*='transcript']"
			);
			for (const el of Array.from(transcriptElements)) {
				const tag = el.tagName.toLowerCase();
				// skip links and buttons
				if (tag === "a" || tag === "button") continue;
				const text = (el.textContent || "").trim();
				// if the element has some real text content, it's likely a transcript
				if (text.length > 10) {
					return true;
				}
			}
		}

		return false;
	};

	const videos = Array.from(document.querySelectorAll("video, iframe[src*='youtube'], iframe[src*='vimeo']"));
	const issues: VideoAccessibilityIssue[] = [];

	// exclude videos in header and footer
	const contentVideos = videos.filter(video => {
		return !video.closest("header") && !video.closest("footer");
	});

	contentVideos.forEach((video, index) => {
		let missingCaptions = false;
		let missingTranscript = false;
		let videoSrc = "";

		if (video.tagName.toLowerCase() === "video") {
			// check for <video> element
			const videoElement = video as HTMLVideoElement;
			videoSrc = videoElement.src || videoElement.currentSrc || "embedded video";

			// check for captions via <track> elements
			const tracks = Array.from(videoElement.querySelectorAll("track"));
			const hasTrackCaptions = tracks.some(track => {
				const kind = track.getAttribute("kind");
				return kind === "captions" || kind === "subtitles";
			});

			if (!hasTrackCaptions) {
				// check for a CC toggle button in the video player's container
				const playerContainer = video.closest(
					"[class*='player'], [class*='video'], figure, .wp-block-video"
				) || video.parentElement;

				if (!playerContainer || !hasCaptionToggle(playerContainer)) {
					missingCaptions = true;
				}
			}
		} else if (video.tagName.toLowerCase() === "iframe") {
			// check for iframe (YouTube, Vimeo, etc.)
			const iframe = video as HTMLIFrameElement;
			videoSrc = iframe.src || "embedded video";
			const src = iframe.src.toLowerCase();

			if (src.includes("youtube")) {
				// YouTube: cc_load_policy=1 forces captions on.  Otherwise, captions
				// are still available via the player's built-in CC button, so we
				// don't flag YouTube embeds as missing captions — the toggle is
				// always present in the YouTube player UI.
				// (no action needed — YouTube always provides a CC button)
			} else if (src.includes("vimeo")) {
				// Vimeo embeds include a CC button when captions are available.
				// We can't inspect inside the iframe, but we check for a CC toggle
				// in the surrounding container in case a custom player wraps it.
				const playerContainer = video.closest(
					"[class*='player'], [class*='video'], figure"
				) || video.parentElement;

				if (playerContainer && hasCaptionToggle(playerContainer)) {
					// found a caption toggle outside the iframe
				} else {
					// can't confirm captions — flag for manual review
					missingCaptions = true;
				}
			} else {
				// unknown iframe video provider — check for a CC toggle nearby
				const playerContainer = video.closest(
					"[class*='player'], [class*='video'], figure"
				) || video.parentElement;

				if (!playerContainer || !hasCaptionToggle(playerContainer)) {
					missingCaptions = true;
				}
			}
		}

		// check for transcript toggle or content near the video
		if (!hasTranscriptToggle(video)) {
			missingTranscript = true;
		}

		// if video has any issues, add to results
		if (missingCaptions || missingTranscript) {
			// mark the video for highlighting
			video.setAttribute("data-a11y-video-issue", "true");

			issues.push({
				videoIndex: index + 1,
				videoSrc: videoSrc.substring(0, 100), // truncate long URLs
				missingCaptions,
				missingTranscript,
			});
		}
	});

	return {
		totalVideos: contentVideos.length,
		issues,
	};
}


/**
 * check all tables on the page for accessibility requirements
 * this function runs in the page context via chrome.scripting.executeScript
 */
export function checkTableAccessibility(): TableAccessibilityResults {
	const tables = Array.from(document.querySelectorAll("table"));
	const issues: TableAccessibilityIssue[] = [];
	
	// exclude tables in header and footer
	const contentTables = tables.filter(table => {
		return !table.closest("header") && !table.closest("footer");
	});
	
	contentTables.forEach((table, index) => {
		let missingCaption = false;
		let missingHeaders = false;
		
		// check for caption
		const caption = table.querySelector("caption");
		if (!caption || caption.textContent?.trim() === "") {
			missingCaption = true;
		}
		
		// check for header row (th elements in thead or first row)
		const hasHeaderRow = table.querySelectorAll("thead th, thead td[scope='col']").length > 0 ||
			(table.querySelector("tbody tr:first-child")?.querySelectorAll("th, td[scope='col']").length || 0) > 0 ||
			(table.querySelector("tr:first-child")?.querySelectorAll("th, td[scope='col']").length || 0) > 0;
		
		// check for header column (th elements with scope='row' or th in first position of rows)
		const hasHeaderColumn = table.querySelectorAll("th[scope='row'], td[scope='row']").length > 0 ||
			Array.from(table.querySelectorAll("tr")).some(row => {
				const firstCell = row.querySelector("td:first-child, th:first-child");
				return firstCell?.tagName.toLowerCase() === "th";
			});
		
		// table must have either header row or header column (or both)
		if (!hasHeaderRow && !hasHeaderColumn) {
			missingHeaders = true;
		}
		
		// if table has any issues, add to results
		if (missingCaption || missingHeaders) {
			// mark the table for highlighting
			table.setAttribute("data-a11y-table-issue", "true");
			
			issues.push({
				missingCaption,
				missingHeaders,
				tableIndex: index + 1,
			});
		}
	});
	
	return {
		totalTables: contentTables.length,
		issues,
	};
}

export interface LinkAccessibilityIssue {
	type: "raw-url" | "vague-text" | "vague-button";
	text: string;
	element: HTMLElement;
}

export interface LinkAccessibilityResults {
	rawUrls: LinkAccessibilityIssue[];
	vagueLinks: LinkAccessibilityIssue[];
	vagueButtons: LinkAccessibilityIssue[];
}

export interface ReadabilityScore {
	score: number;
	gradeLevel: string;
	interpretation: string;
	characterCount: number;
	wordCount: number;
	sentenceCount: number;
	recommendation: string;
	factors: string[];
	extractedText?: string;
	structureIssues?: string[];
}

/**
 * scan the page for inaccessible links
 * this function runs in the page context via chrome.scripting.executeScript
 */
export function checkLinkAccessibility(): LinkAccessibilityResults {
	const rawUrls: LinkAccessibilityIssue[] = [];
	const vagueLinks: LinkAccessibilityIssue[] = [];
	const vagueButtons: LinkAccessibilityIssue[] = [];
	
	// clean up any previous markers
	const previouslyMarked = document.querySelectorAll("[data-a11y-link-issue]");
	previouslyMarked.forEach(el => {
		el.removeAttribute("data-a11y-link-issue");
		if (el instanceof HTMLElement) {
			el.style.outline = "";
			el.style.outlineOffset = "";
		}
	});
	
	// vague link text patterns (exact matches only, case insensitive)
	const vaguePhrases = [
		"click here",
		"read more",
		"more",
		"here",
		"info",
		"link",
		"this",
		"continue",
		"learn more",
	];
	
	// vague button text patterns (exact matches only, case insensitive)
	const vagueButtonPhrases = [
		"click",
		"click here",
		"submit",
		"go",
		"ok",
		"yes",
		"no",
		"button",
		"press",
		"continue",
		"next",
		"back",
		"more",
	];
	
	// helper: check if element is visible
	const isVisible = (el: HTMLElement): boolean => {
		if (el.offsetParent === null) return false;
		const style = window.getComputedStyle(el);
		return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
	};
	
	// helper: check if text contains a URL pattern
	const containsUrl = (text: string): boolean => {
		const urlPattern = /(?:https?:\/\/|www\.)\S+/i;
		return urlPattern.test(text);
	};
	
	// helper: check if text is an email
	const isEmail = (text: string): boolean => {
		const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailPattern.test(text.trim());
	};
	
	// helper: get all text content from element, including nested elements
	const getFullText = (el: HTMLElement): string => {
		return el.textContent?.trim() || "";
	};
	
	// helper: check if link has accessible context from aria-label or image alt
	const hasAccessibleContext = (link: HTMLAnchorElement): boolean => {
		// check for aria-label
		if (link.getAttribute("aria-label")?.trim()) {
			return true;
		}
		
		// check for images with alt text inside the link
		const images = link.querySelectorAll("img");
		for (const img of Array.from(images)) {
			const alt = img.getAttribute("alt");
			if (alt && alt.trim()) {
				return true;
			}
		}
		
		return false;
	};
	
	// helper: check if button has accessible context from aria-label or aria-labelledby
	const buttonHasAccessibleContext = (button: HTMLElement): boolean => {
		// check for aria-label
		if (button.getAttribute("aria-label")?.trim()) {
			return true;
		}
		
		// check for aria-labelledby
		if (button.getAttribute("aria-labelledby")?.trim()) {
			return true;
		}
		
		// check for images with alt text inside the button
		const images = button.querySelectorAll("img");
		for (const img of Array.from(images)) {
			const alt = img.getAttribute("alt");
			if (alt && alt.trim()) {
				return true;
			}
		}
		
		return false;
	};
	
	// scan for raw URLs in text nodes
	const walker = document.createTreeWalker(
		document.body,
		NodeFilter.SHOW_TEXT,
		{
			acceptNode: (node) => {
				// skip if parent is script, style, or hidden
				const parent = node.parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;
				
				const tagName = parent.tagName.toLowerCase();
				if (tagName === "script" || tagName === "style") {
					return NodeFilter.FILTER_REJECT;
				}
				
				if (!isVisible(parent)) {
					return NodeFilter.FILTER_REJECT;
				}
				
				// skip if inside header or footer
				if (parent.closest("header") || parent.closest("footer")) {
					return NodeFilter.FILTER_REJECT;
				}
				
				return NodeFilter.FILTER_ACCEPT;
			},
		}
	);
	
	const textNodes: Node[] = [];
	let currentNode: Node | null;
	while ((currentNode = walker.nextNode())) {
		textNodes.push(currentNode);
	}
	
	// check text nodes for raw URLs
	textNodes.forEach(node => {
		const text = node.textContent || "";
		if (containsUrl(text) && !isEmail(text)) {
			const parent = node.parentElement;
			if (parent) {
				// extract just the URL portion
				const urlMatch = text.match(/(?:https?:\/\/|www\.)\S+/i);
				if (urlMatch) {
					parent.setAttribute("data-a11y-link-issue", "raw-url");
					rawUrls.push({
						type: "raw-url",
						text: urlMatch[0],
						element: parent,
					});
				}
			}
		}
	});
	
	// scan all anchor tags
	const links = Array.from(document.querySelectorAll("a[href]"));
	
	links.forEach(link => {
		if (!(link instanceof HTMLAnchorElement)) return;
		
		// skip if not visible
		if (!isVisible(link)) return;
		
		// skip if in header or footer
		if (link.closest("header") || link.closest("footer")) return;
		
		const fullText = getFullText(link).toLowerCase();
		
		// check for raw URLs in link text
		if (containsUrl(fullText) && !isEmail(fullText)) {
			link.setAttribute("data-a11y-link-issue", "raw-url");
			rawUrls.push({
				type: "raw-url",
				text: fullText,
				element: link,
			});
		}
		
		// check for vague link text (exact match only)
		if (vaguePhrases.includes(fullText)) {
			// check if link has accessible context
			if (!hasAccessibleContext(link)) {
				link.setAttribute("data-a11y-link-issue", "vague-text");
				vagueLinks.push({
					type: "vague-text",
					text: fullText,
					element: link,
				});
			}
		}
	});
	
	// scan all button elements and elements with role="button"
	const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
	
	buttons.forEach(button => {
		if (!(button instanceof HTMLElement)) return;
		
		// skip if not visible
		if (!isVisible(button)) return;
		
		// skip if in header or footer
		if (button.closest("header") || button.closest("footer")) return;
		
		const fullText = getFullText(button).toLowerCase();
		
		// check if button has accessible context
		const hasContext = buttonHasAccessibleContext(button);
		
		// flag if button has no accessible context and meets any of these conditions:
		// 1. matches vague button phrases exactly
		// 2. is empty or only whitespace
		// 3. contains no alphanumeric characters (only symbols/emojis)
		// 4. is very short (1-2 characters)
		
		let shouldFlag = false;
		let flagReason = "";
		
		if (vagueButtonPhrases.includes(fullText)) {
			shouldFlag = true;
			flagReason = fullText;
		} else if (fullText.trim() === "") {
			shouldFlag = true;
			flagReason = "(empty)";
		} else if (!/[a-z0-9]/i.test(fullText)) {
			// no alphanumeric characters (only symbols, emojis, punctuation)
			shouldFlag = true;
			flagReason = fullText || "(symbol only)";
		} else if (fullText.length <= 2) {
			// very short text (1-2 characters)
			shouldFlag = true;
			flagReason = fullText;
		}
		
		if (shouldFlag && !hasContext) {
			button.setAttribute("data-a11y-link-issue", "vague-button");
			vagueButtons.push({
				type: "vague-button",
				text: flagReason,
				element: button,
			});
		}
	});
	
	return {
		rawUrls,
		vagueLinks,
		vagueButtons,
	};
}

/**
 * calculate readability score using Automated Readability Index (similar to Hemingway App)
 * this function runs in the page context via chrome.scripting.executeScript
 */
export function calculateReadabilityScore(): ReadabilityScore {
	// helper: check if element should be excluded from readability analysis
	const shouldExclude = (el: Element): boolean => {
		// exclude header, footer, nav, forms, code blocks, scripts, styles
		const excludedTags = ["header", "footer", "nav", "form", "code", "pre", "script", "style", "button", "input", "select", "textarea"];
		const tagName = el.tagName.toLowerCase();
		
		if (excludedTags.includes(tagName)) return true;
		if (el.closest("header, footer, nav, form, code, pre")) return true;
		
		// exclude hidden elements
		if (el instanceof HTMLElement) {
			const style = window.getComputedStyle(el);
			if (style.display === "none" || style.visibility === "hidden") return true;
		}
		
		return false;
	};
	
	// extract text content - try multiple strategies like Hemingway might
	let textContent = "";
	
	// strategy 1: look for main content areas (most specific first)
	const contentSelectors = [
		"main",
		"[role='main']", 
		"article",
		".main-content",
		".content",
		"#content",
		".post-content",
		".entry-content"
	];
	
	let mainContent: Element | null = null;
	for (const selector of contentSelectors) {
		mainContent = document.querySelector(selector);
		if (mainContent) break;
	}
	
	if (mainContent) {
		// walk through main content and collect text
		const walker = document.createTreeWalker(
			mainContent,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode: (node) => {
					const parent = node.parentElement;
					if (!parent) return NodeFilter.FILTER_REJECT;
					if (shouldExclude(parent)) return NodeFilter.FILTER_REJECT;
					return NodeFilter.FILTER_ACCEPT;
				},
			}
		);
		
		let currentNode: Node | null;
		while ((currentNode = walker.nextNode())) {
			const text = currentNode.textContent || "";
			if (text.trim()) {
				textContent += text + " ";
			}
		}
	} else {
		// fallback: use body but be more aggressive about exclusions
		const bodyClone = document.body.cloneNode(true) as HTMLElement;
		
		// remove more elements that Hemingway likely excludes
		const excludeSelectors = [
			"header", "footer", "nav", "aside", 
			"form", "code", "pre", "script", "style", 
			"button", "input", "select", "textarea",
			".header", ".footer", ".nav", ".navigation", ".sidebar",
			".menu", ".breadcrumb", ".pagination", ".social",
			".advertisement", ".ad", ".banner", ".popup",
			"[role='banner']", "[role='navigation']", "[role='complementary']"
		].join(", ");
		
		bodyClone.querySelectorAll(excludeSelectors).forEach(el => el.remove());
		textContent = bodyClone.textContent || "";
	}
	
	console.log("[Readability Debug] Raw text length:", textContent.length);
	console.log("[Readability Debug] First 200 chars:", textContent.substring(0, 200));
	
	// clean up text more aggressively like Hemingway
	textContent = textContent
		.trim()
		// normalize whitespace
		.replace(/\s+/g, " ")
		// remove extra punctuation that might interfere
		.replace(/[""'']/g, '"')
		.replace(/[–—]/g, '-')
		// remove URLs and email addresses
		.replace(/https?:\/\/[^\s]+/g, '')
		.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
		// remove numbers that aren't part of words (like dates, phone numbers)
		.replace(/\b\d+\b/g, '')
		// clean up extra spaces again
		.replace(/\s+/g, " ")
		.trim();
	
	console.log("[Readability Debug] Cleaned text length:", textContent.length);
	console.log("[Readability Debug] Cleaned first 200 chars:", textContent.substring(0, 200));
	
	// count characters (letters only, like Hemingway likely does)
	const characterCount = textContent.replace(/[^a-zA-Z]/g, "").length;
	
	// count words (very strict approach)
	const words = textContent
		.split(/\s+/)
		.map(word => word.replace(/[^\w]/g, ''))
		.filter(word => word.length > 0 && /^[a-zA-Z]+$/.test(word));
	const wordCount = words.length;
	
	// count sentences - be much more conservative about splitting
	// The issue might be that we're over-splitting sentences, making them appear shorter than they are
	let sentences = textContent
		.split(/[.!?]+/)
		.map(s => s.trim())
		.filter(s => s.length > 0);
	
	const initialAvgWords = wordCount / sentences.length;
	
	console.log("[Readability Debug] Initial sentence count:", sentences.length);
	console.log("[Readability Debug] Initial avg words per sentence:", initialAvgWords);
	console.log("[Readability Debug] Sample sentences:", sentences.slice(0, 5));
	
	// detect if this is simple, instructional content (like marriage license page)
	const hasSimplePatterns = /(?:what to|how to|you must|you need|you can|step \d|before you)/i.test(textContent);
	const hasListPatterns = /(?:[-•*]\s|\d+\.\s)/g.test(textContent);
	
	// be MUCH more conservative about additional sentence splitting
	// Only split if we have very clear evidence of simple, instructional content
	const isVerySimpleContent = (hasSimplePatterns && hasListPatterns) && initialAvgWords < 12;
	
	console.log("[Readability Debug] Has simple patterns:", hasSimplePatterns);
	console.log("[Readability Debug] Has list patterns:", hasListPatterns);
	console.log("[Readability Debug] Detected very simple content:", isVerySimpleContent);
	
	// Only do additional splitting for very clearly simple content
	if (isVerySimpleContent) {
		const additionalSentences: string[] = [];
		sentences.forEach(sentence => {
			// split on list patterns and very clear instruction words only
			const subSentences = sentence
				.split(/(?:\s*[-•*]\s*|\s*\d+\.\s*|\s*(?:You must|You need|You can|You will)\s*)/i)
				.map(s => s.trim())
				.filter(s => s.length > 0);
			additionalSentences.push(...subSentences);
		});
		
		// use additional splitting only if it creates reasonable sentence lengths
		const additionalAvgWords = wordCount / additionalSentences.length;
		if (additionalSentences.length > sentences.length && additionalAvgWords >= 8) {
			sentences = additionalSentences;
			console.log("[Readability Debug] Used additional splitting");
		}
	}
	
	// filter to meaningful sentences (be more lenient for complex content)
	const minWords = isVerySimpleContent ? 3 : 5;
	const finalSentences = sentences.filter(sentence => {
		const wordCount = sentence.split(/\s+/).filter(w => /[a-zA-Z]/.test(w)).length;
		return wordCount >= minWords;
	});
	
	const sentenceCount = finalSentences.length;
	const finalAvgWords = wordCount / sentenceCount;
	
	console.log("[Readability Debug] Final sentence count:", sentenceCount);
	console.log("[Readability Debug] Final avg words per sentence:", finalAvgWords);
	
	// calculate ARI score (pure formula, no adjustments yet)
	let score = 0;
	let gradeLevel = "N/A";
	let interpretation = "Not enough text to analyze";
	let recommendation = "";
	
	if (wordCount > 0 && sentenceCount > 0) {
		const charsPerWord = characterCount / wordCount;
		const wordsPerSentence = wordCount / sentenceCount;
		
		console.log("[Readability Debug] Chars per word:", charsPerWord);
		console.log("[Readability Debug] Words per sentence:", wordsPerSentence);
		
		// standard ARI formula
		const rawScore = 4.71 * charsPerWord + 0.5 * wordsPerSentence - 21.43;
		
		console.log("[Readability Debug] Raw ARI score:", rawScore);
		
		// be much more conservative with adjustments
		// Only apply small adjustments for very clearly simple content
		let adjustment = 0.0;
		
		if (isVerySimpleContent && finalAvgWords < 8) {
			adjustment = 0.5; // very conservative adjustment
		} else if (isVerySimpleContent && finalAvgWords < 10) {
			adjustment = 0.2; // minimal adjustment
		}
		// for anything else, apply no adjustment
		
		score = rawScore - adjustment;
		
		// ensure minimum score of 0
		score = Math.max(0, score);
		
		console.log("[Readability Debug] Adjustment applied:", adjustment);
		console.log("[Readability Debug] Final adjusted score:", score);
		
		// round to whole number
		score = Math.round(score);
		
		// determine grade level
		if (score < 1) {
			gradeLevel = "Kindergarten";
			interpretation = "Very easy to read for all ages";
		} else if (score < 2) {
			gradeLevel = "1st Grade";
			interpretation = "Very easy to read for ages 6-7";
		} else if (score < 3) {
			gradeLevel = "2nd Grade";
			interpretation = "Very easy to read for ages 7-8";
		} else if (score < 4) {
			gradeLevel = "3rd Grade";
			interpretation = "Easy to read for ages 8-9";
		} else if (score < 5) {
			gradeLevel = "4th Grade";
			interpretation = "Easy to read for ages 9-10";
		} else if (score < 6) {
			gradeLevel = "5th Grade";
			interpretation = "Fairly easy to read for ages 10-11";
		} else if (score < 7) {
			gradeLevel = "6th Grade";
			interpretation = "Fairly easy to read for ages 11-12";
		} else if (score < 8) {
			gradeLevel = "7th Grade";
			interpretation = "Fairly easy to read for ages 12-13";
		} else if (score < 9) {
			gradeLevel = "8th Grade";
			interpretation = "Plain English, easily understood by 13-14 year olds";
		} else if (score < 10) {
			gradeLevel = "9th Grade";
			interpretation = "Fairly difficult to read for ages 14-15";
		} else if (score < 11) {
			gradeLevel = "10th Grade";
			interpretation = "Fairly difficult to read for ages 15-16";
		} else if (score < 12) {
			gradeLevel = "11th Grade";
			interpretation = "Difficult to read for ages 16-17";
		} else if (score < 13) {
			gradeLevel = "12th Grade";
			interpretation = "Difficult to read for ages 17-18";
		} else if (score < 14) {
			gradeLevel = "College";
			interpretation = "Very difficult to read, college level";
		} else {
			gradeLevel = "Post-graduate";
			interpretation = "Very difficult to read, professional level";
		}
		
		// analyze specific factors that contribute to readability
		const factors: string[] = [];
		
		// analyze sentence length
		if (wordsPerSentence <= 12) {
			factors.push("Keep using short sentences - they make your content easy to read");
		} else if (wordsPerSentence <= 18) {
			factors.push("Try breaking up some longer sentences to improve readability");
		} else if (wordsPerSentence <= 25) {
			factors.push("Break up long sentences - aim for 15 words or fewer per sentence");
		} else {
			factors.push("Your sentences are too long - split them into shorter, clearer sentences");
		}
		
		// analyze word complexity (characters per word)
		if (charsPerWord <= 4.5) {
			factors.push("Good use of simple, everyday words that everyone can understand");
		} else if (charsPerWord <= 5.2) {
			factors.push("Replace complex words with simpler alternatives when possible");
		} else if (charsPerWord <= 6.0) {
			factors.push("Use shorter, more common words instead of complex vocabulary");
		} else {
			factors.push("Simplify your vocabulary - choose everyday words over technical terms");
		}
		
		// analyze overall text structure
		if (sentenceCount < 10) {
			factors.push("Your brief, focused content is easy for readers to follow");
		} else if (sentenceCount > 50) {
			factors.push("Consider breaking long content into sections with clear headings");
		}
		
		// analyze paragraph and heading structure
		const structureIssues: string[] = [];
		
		// find main content area
		let contentArea: Element | null = null;
		for (const selector of contentSelectors) {
			contentArea = document.querySelector(selector);
			if (contentArea) break;
		}
		
		if (contentArea) {
			// check paragraph lengths
			const paragraphs = Array.from(contentArea.querySelectorAll("p")).filter(p => {
				if (shouldExclude(p)) return false;
				const text = p.textContent?.trim() || "";
				return text.length > 0;
			});
			
			const longParagraphs = paragraphs.filter(p => {
				const text = p.textContent?.trim() || "";
				const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
				return sentences.length > 3;
			});
			
			if (longParagraphs.length > 0) {
				structureIssues.push(`Break up long paragraphs - found ${longParagraphs.length} paragraph${longParagraphs.length > 1 ? 's' : ''} with more than 3 sentences. Aim for 1-2 sentences per paragraph for better readability`);
			}
			
			// check for long sections without headings
			const allElements = Array.from(contentArea.querySelectorAll("*")).filter(el => !shouldExclude(el));
			let textSinceLastHeading = 0;
			let hasLongSection = false;
			
			for (const el of allElements) {
				const tagName = el.tagName.toLowerCase();
				
				// reset counter at headings
				if (/^h[1-6]$/.test(tagName)) {
					textSinceLastHeading = 0;
				} else if (tagName === "p") {
					const text = el.textContent?.trim() || "";
					const words = text.split(/\s+/).filter(w => w.length > 0);
					textSinceLastHeading += words.length;
					
					// if we've accumulated more than 150 words without a heading, flag it
					if (textSinceLastHeading > 150) {
						hasLongSection = true;
						break;
					}
				}
			}
			
			if (hasLongSection) {
				structureIssues.push("Break up long sections of text with descriptive headings - this helps readers scan and find information quickly");
			}
		}
		
		// provide recommendation based on score
		if (score <= 6) {
			recommendation = "Excellent! Very readable for a general audience.";
		} else if (score <= 9) {
			recommendation = "Good readability. Most adults can read this easily.";
		} else if (score <= 13) {
			recommendation = "Fairly difficult. Consider simplifying sentences and word choices.";
		} else {
			recommendation = "Very difficult to read. Significant simplification needed for broader accessibility.";
		}
		
		return {
			score,
			gradeLevel,
			interpretation,
			characterCount,
			wordCount,
			sentenceCount: finalSentences.length,
			recommendation,
			factors,
			extractedText: textContent,
			structureIssues: structureIssues.length > 0 ? structureIssues : undefined,
		};
	}
	
	return {
		score,
		gradeLevel,
		interpretation,
		characterCount,
		wordCount,
		sentenceCount: 0,
		recommendation,
		factors: [],
		extractedText: "",
	};
}
