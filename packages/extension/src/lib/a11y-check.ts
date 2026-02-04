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
