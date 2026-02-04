// accessibility check utilities

export interface HeadingInfo {
	level: number;
	text: string;
	element: HTMLElement;
}

export interface HeadingNestingIssue {
	fromLevel: number;
	toLevel: number;
	fromText: string;
	toText: string;
	toElement: HTMLElement;
}

export interface HeadingWithContext {
	level: number;
	text: string;
	contentBelow: string;
	allHeadings: string[];
	pageTitle: string;
}

export interface HeadingDescriptivenessResult {
	heading: string;
	level: number;
	isHelpful: boolean;
	reason: string;
	contentPreview: string;
}

/**
 * extract all headings from the page and check for improper nesting
 * this function runs in the page context via chrome.scripting.executeScript
 */
export function checkHeadingNesting(): HeadingNestingIssue[] {
	const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
	const issues: HeadingNestingIssue[] = [];

	for (let i = 1; i < headings.length; i++) {
		const prevHeading = headings[i - 1];
		const currHeading = headings[i];

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

/**
 * highlight elements on the page with yellow background
 * this function runs in the page context via chrome.scripting.executeScript
 */
export function highlightElements(selector: string): void {
	const elements = document.querySelectorAll(selector);
	elements.forEach(el => {
		if (el instanceof HTMLElement) {
			el.style.backgroundColor = "yellow";
			el.style.outline = "2px solid orange";
		}
	});
}

/**
 * analyze heading descriptiveness using heuristics
 * checks if headings are specific, logical, and accurately describe content
 */
export function analyzeHeadingDescriptiveness(
	headingsWithContext: HeadingWithContext[]
): HeadingDescriptivenessResult[] {
	const results: HeadingDescriptivenessResult[] = [];

	// headings to ignore (common structural headings that don't need analysis)
	const ignoredHeadings = [
		"services",
		"resources",
		"address",
		"email",
		"phone",
		"calendar",
		"upcoming calendar",
		"contact information",
		"news",
		"related",
		"partner agencies",
		"contact us",
	];

	// common vague/generic headings that are often unhelpful
	const vaguePhrases = [
		"overview",
		"introduction",
		"details",
		"information",
		"more",
		"learn more",
		"click here",
		"read more",
		"general",
		"other",
		"miscellaneous",
		"additional",
		"related",
	];

	// filter out ignored headings FIRST
	const filteredHeadings = headingsWithContext.filter(h => 
		!ignoredHeadings.includes(h.text.toLowerCase())
	);

	console.log("Filtered headings for analysis:", filteredHeadings.map(h => h.text));

	// check for duplicate headings AFTER filtering
	const headingCounts = new Map<string, number>();
	filteredHeadings.forEach(h => {
		const lower = h.text.toLowerCase();
		headingCounts.set(lower, (headingCounts.get(lower) || 0) + 1);
	});

	console.log("Heading counts:", Array.from(headingCounts.entries()));

	for (const heading of filteredHeadings) {
		const headingLower = heading.text.toLowerCase();
		const contentLower = heading.contentBelow.toLowerCase();
		const words = heading.text.split(/\s+/).filter(w => w.length > 0);
		const count = headingCounts.get(headingLower)!;

		let isHelpful = true;
		let reason = "Heading is clear and descriptive";

		// check 1: heading is too short (1-2 words) and generic
		if (words.length <= 2 && vaguePhrases.some(phrase => headingLower.includes(phrase))) {
			isHelpful = false;
			reason = "Heading is too vague or generic";
		}
		// check 2: heading is a single generic word
		else if (words.length === 1 && vaguePhrases.includes(headingLower)) {
			isHelpful = false;
			reason = "Single-word heading is not descriptive enough";
		}
		// check 3: duplicate headings on the same page
		else if (count > 1) {
			isHelpful = false;
			reason = "Duplicate heading - users may be confused about which section to navigate to";
			console.log(`Duplicate detected: "${heading.text}" appears ${count} times`);
		}
		// check 4: heading doesn't relate to content below
		else if (heading.contentBelow.length > 50) {
			// extract key terms from heading (words longer than 3 chars)
			const headingTerms = words
				.filter(w => w.length > 3)
				.map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ""));

			// check if any heading terms appear in the content
			const hasMatchingTerms = headingTerms.some(term => 
				contentLower.includes(term)
			);

			if (headingTerms.length > 0 && !hasMatchingTerms) {
				isHelpful = false;
				reason = "Heading doesn't match the content below it";
			}
		}
		// check 5: heading is just a question mark or punctuation
		else if (heading.text.replace(/[^a-zA-Z0-9]/g, "").length === 0) {
			isHelpful = false;
			reason = "Heading contains no meaningful text";
		}
		// check 6: heading is very long (likely a sentence, not a heading)
		else if (words.length > 15) {
			isHelpful = false;
			reason = "Heading is too long - consider making it more concise";
		}
		// positive indicators: specific, descriptive headings
		else if (words.length >= 3 && words.length <= 8) {
			// headings with good length and specific terms are likely helpful
			const hasSpecificTerms = words.some(w => 
				w.length > 5 && !vaguePhrases.includes(w.toLowerCase())
			);
			if (hasSpecificTerms) {
				isHelpful = true;
				reason = "Heading is specific and descriptive";
			}
		}

		results.push({
			heading: heading.text,
			level: heading.level,
			isHelpful,
			reason,
			contentPreview: heading.contentBelow.substring(0, 150),
		});
	}

	return results;
}

/**
 * extract headings with their context for descriptiveness analysis
 * this function runs in the page context via chrome.scripting.executeScript
 */
export function extractHeadingsWithContext(): HeadingWithContext[] {
	const headings = Array.from(document.querySelectorAll("h2, h3, h4, h5, h6"));
	const allHeadingTexts = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
		.map(h => h.textContent?.trim() || "");
	const pageTitle = document.title;

	// filter out hidden elements and deduplicate by element reference
	const uniqueHeadings = new Map<HTMLElement, boolean>();
	const filteredHeadings = headings.filter(h => {
		if (!(h instanceof HTMLElement)) return false;
		
		// skip if already processed
		if (uniqueHeadings.has(h)) return false;
		
		// skip hidden elements (display: none, visibility: hidden, or zero dimensions)
		const style = window.getComputedStyle(h);
		if (style.display === "none" || 
			style.visibility === "hidden" || 
			h.offsetWidth === 0 || 
			h.offsetHeight === 0) {
			return false;
		}
		
		uniqueHeadings.set(h, true);
		return true;
	});

	return filteredHeadings.map(heading => {
		const headingText = heading.textContent?.trim() || "";
		const level = parseInt(heading.tagName.substring(1));

		// get content below the heading until the next heading of same or higher level
		let contentBelow = "";
		let currentElement = heading.nextElementSibling;
		
		while (currentElement) {
			const tagName = currentElement.tagName.toLowerCase();
			
			// stop if we hit another heading of same or higher level
			if (tagName.match(/^h[1-6]$/)) {
				const nextLevel = parseInt(tagName.substring(1));
				if (nextLevel <= level) {
					break;
				}
			}
			
			// collect text content from paragraphs, lists, divs, etc.
			const text = currentElement.textContent?.trim() || "";
			if (text) {
				contentBelow += text + " ";
			}
			
			currentElement = currentElement.nextElementSibling;
		}

		return {
			level,
			text: headingText,
			contentBelow: contentBelow.trim().substring(0, 500), // limit to 500 chars
			allHeadings: allHeadingTexts,
			pageTitle,
		};
	});
}

/**
 * remove all highlights from the page
 * this function runs in the page context via chrome.scripting.executeScript
 */
export function removeHighlights(): void {
	const elements = document.querySelectorAll("[style*='background-color: yellow']");
	elements.forEach(el => {
		if (el instanceof HTMLElement) {
			el.style.backgroundColor = "";
			el.style.outline = "";
		}
	});
}
