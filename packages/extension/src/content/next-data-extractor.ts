// content script for extracting page data from __NEXT_DATA__ script tag
// injected into SF.gov pages to extract page data from the DOM

import { transformNextDataToWagtailPage } from "@/api/page-data-transformer";
import type { WagtailPage } from "@sf-gov/shared";

// message types
interface PageDataExtractedMessage {
	type: "PAGE_DATA_EXTRACTED";
	data: WagtailPage;
	timestamp: number;
}

interface PageDataExtractionFailedMessage {
	type: "PAGE_DATA_EXTRACTION_FAILED";
	reason: string;
	timestamp: number;
}

interface RequestPageDataMessage {
	type: "REQUEST_PAGE_DATA";
}

/**
 * extracts the page object from __NEXT_DATA__ script tag
 * @returns the raw page data object from props.pageProps.page, or null if extraction fails
 */
export function extractNextDataPage(): { data: Record<string, unknown>; error?: never } | { data?: never; error: string } {
	try {
		// locate the __NEXT_DATA__ script tag
		const scriptElement = document.getElementById("__NEXT_DATA__");
		
		if (!scriptElement) {
			return { error: "__NEXT_DATA__ script tag not found" };
		}

		// parse the JSON content
		const textContent = scriptElement.textContent;
		
		if (!textContent) {
			return { error: "__NEXT_DATA__ script tag is empty" };
		}

		let parsedData: any;
		try {
			parsedData = JSON.parse(textContent);
		} catch (parseError) {
			return { error: `Invalid JSON in __NEXT_DATA__: ${parseError instanceof Error ? parseError.message : String(parseError)}` };
		}

		// extract props.pageProps.page
		const pageData = parsedData?.props?.pageProps?.page;
		
		if (!pageData || typeof pageData !== "object") {
			return { error: "props.pageProps.page not found in __NEXT_DATA__" };
		}

		return { data: pageData as Record<string, unknown> };
	} catch (error) {
		return { error: `Unexpected error during extraction: ${error instanceof Error ? error.message : String(error)}` };
	}
}

/**
 * performs the full extraction and transformation process
 * sends either PAGE_DATA_EXTRACTED or PAGE_DATA_EXTRACTION_FAILED message
 */
function performExtraction(): void {
	console.log("[next-data-extractor] starting extraction on", window.location.href);

	// extract raw page data
	const extractionResult = extractNextDataPage();
	
	if ("error" in extractionResult) {
		console.warn("[next-data-extractor] extraction failed:", extractionResult.error);
		sendExtractionFailed(extractionResult.error!);
		return;
	}

	// transform to WagtailPage format
	try {
		const wagtailPage = transformNextDataToWagtailPage(extractionResult.data, window.location.href);
		console.log("[next-data-extractor] extraction successful, page id:", wagtailPage.id);
		sendExtractionSuccess(wagtailPage);
	} catch (transformError) {
		const errorMessage = `Transformation failed: ${transformError instanceof Error ? transformError.message : String(transformError)}`;
		console.warn("[next-data-extractor]", errorMessage);
		sendExtractionFailed(errorMessage);
	}
}

/**
 * sends PAGE_DATA_EXTRACTED message to the extension runtime
 */
async function sendExtractionSuccess(data: WagtailPage): Promise<void> {
	const message: PageDataExtractedMessage = {
		type: "PAGE_DATA_EXTRACTED",
		data,
		timestamp: Date.now(),
	};

	try {
		await chrome.runtime.sendMessage(message);
		console.log("[next-data-extractor] PAGE_DATA_EXTRACTED message sent");
	} catch (error) {
		console.warn("[next-data-extractor] failed to send message:", error);
	}
}

/**
 * sends PAGE_DATA_EXTRACTION_FAILED message to the extension runtime
 */
async function sendExtractionFailed(reason: string): Promise<void> {
	const message: PageDataExtractionFailedMessage = {
		type: "PAGE_DATA_EXTRACTION_FAILED",
		reason,
		timestamp: Date.now(),
	};

	try {
		await chrome.runtime.sendMessage(message);
		console.log("[next-data-extractor] PAGE_DATA_EXTRACTION_FAILED message sent");
	} catch (error) {
		console.warn("[next-data-extractor] failed to send message:", error);
	}
}

/**
 * listen for REQUEST_PAGE_DATA messages from the side panel
 */
chrome.runtime.onMessage.addListener((message: RequestPageDataMessage, _sender, _sendResponse) => {
	if (message.type === "REQUEST_PAGE_DATA") {
		console.log("[next-data-extractor] received REQUEST_PAGE_DATA, re-running extraction");
		performExtraction();
	}
});

// run extraction automatically when script loads (at document_idle)
performExtraction();
