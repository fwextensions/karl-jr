import { useState, useEffect } from "react";
import { Button } from "./Button";
import { trackEvent, trackError } from "@/lib/analytics";
import {
	checkHeadingNesting,
	checkImageAltText,
	checkLinkAccessibility,
	checkTableAccessibility,
	checkVideoAccessibility,
	calculateReadabilityScore,
	extractPageText,
	type HeadingNestingIssue,
	type ImageAltTextInfo,
	type LinkAccessibilityResults,
	type TableAccessibilityResults,
	type VideoAccessibilityResults,
	type ReadabilityScore,
} from "@/lib/a11y-check";
import type { MediaAsset } from "@sf-gov/shared";

// ─── helpers ────────────────────────────────────────────────────────────

/** run a function in the active tab and return its result */
async function executeInTab<T>(tabId: number, func: () => T): Promise<T | undefined> {
	const [result] = await chrome.scripting.executeScript({
		target: { tabId },
		func,
	});
	return result?.result as T | undefined;
}

const emptyLinkResults: LinkAccessibilityResults = {
	rawUrls: [],
	vagueLinks: [],
	vagueButtons: [],
};

// ─── result sub-components ──────────────────────────────────────────────

const SpinnerIcon = () => (
	<svg
		className="animate-spin h-4 w-4 text-white"
		xmlns="http://www.w3.org/2000/svg"
		fill="none"
		viewBox="0 0 24 24"
	>
		<circle
			className="opacity-25"
			cx="12"
			cy="12"
			r="10"
			stroke="currentColor"
			strokeWidth="4"
		></circle>
		<path
			className="opacity-75"
			fill="currentColor"
			d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
		></path>
	</svg>
);

const PassMessage = ({ children }: { children: string }) => (
	<div className="p-3 bg-green-50 text-green-700 text-sm rounded border border-green-100">
		{children}
	</div>
);

const HeadingNestingResults = ({ issues }: { issues: HeadingNestingIssue[] }) => {
	if (issues.length === 0) {
		return <PassMessage>All headings are properly nested!</PassMessage>;
	}

	return (
		<div className="space-y-4">
			<div className="text-sm text-red-600 font-semibold">
				Improperly nested headings found ({issues.length})
			</div>

			<div className="space-y-3">
				{issues.map((issue, index) => (
					<div key={index} className="p-3 bg-red-50 rounded border border-red-100 text-sm">
						<div className="font-medium text-red-700 mb-2">
							H{issue.fromLevel} to H{issue.toLevel}
						</div>
						<div className="space-y-1 text-gray-700">
							<div className="flex items-start gap-2">
								<span className="font-semibold shrink-0">From:</span>
								<span className="break-words">{issue.fromText}</span>
							</div>
							<div className="flex items-start gap-2">
								<span className="font-semibold shrink-0">To:</span>
								<span className="break-words bg-yellow-200 px-1">{issue.toText}</span>
							</div>
						</div>
					</div>
				))}
			</div>

			<div className="text-xs text-gray-600 italic">
				Headings with issues are highlighted in yellow on the page.
			</div>
		</div>
	);
};

const ImageAltTextResults = ({ results, apiImages }: { results: ImageAltTextInfo[]; apiImages: MediaAsset[] }) => {
	if (results.length === 0) {
		return (
			<div className="p-3 bg-gray-50 text-gray-600 text-sm rounded border border-gray-100">
				You haven't added any images to this page.
			</div>
		);
	}

	// create a set of decorative image URLs to exclude from the check
	const decorativeImageUrls = new Set(
		apiImages.filter(img => img.isDecorative).map(img => img.url)
	);

	const missingAltText = results.filter(info => !info.hasAltText && !decorativeImageUrls.has(info.url));

	if (missingAltText.length === 0) {
		return <PassMessage>All images have alt text, or have been marked as decorative!</PassMessage>;
	}

	// create a set of API image URLs for comparison
	const apiImageUrls = new Set(apiImages.filter(img => !img.isDecorative).map(img => img.url));

	// separate images into those in API and those not in API
	const imagesInApi = missingAltText.filter(info => apiImageUrls.has(info.url));
	const imagesNotInApi = missingAltText.filter(info => !apiImageUrls.has(info.url));

	const imageWord = missingAltText.length === 1 ? "image" : "images";
	const verbWord = missingAltText.length === 1 ? "is" : "are";

	return (
		<div className="space-y-3">
			<div className="p-3 bg-amber-50 text-amber-900 text-sm rounded border border-amber-100">
				<p className="flex items-start gap-2">
					<span>
						{missingAltText.length} {imageWord} on this page {verbWord} missing alt text.{" "}
						{imagesInApi.length > 0 && (
							<span className="text-amber-600 shrink-0">
								Look for ⚠️ under Images and documents.
							</span>
						)}
					</span>
				</p>
			</div>

			{imagesNotInApi.length > 0 && (
				<div className="p-3 bg-amber-50 text-amber-900 text-sm rounded border border-amber-100">
					<p className="font-semibold mb-2">
						Images not listed in "Images and documents":
					</p>
					<ul className="list-disc list-outside pl-4 space-y-1 text-xs">
						{imagesNotInApi.map((info, index) => (
							<li key={index} className="break-all">
								{info.filename || info.url}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
};

const LinkAccessibilityResultsComponent = ({ results }: { results: LinkAccessibilityResults }) => {
	const totalIssues = results.rawUrls.length + results.vagueLinks.length + results.vagueButtons.length;

	if (totalIssues === 0) {
		return <PassMessage>All links and buttons are accessible!</PassMessage>;
	}

	return (
		<div className="space-y-4">
			<div className="text-sm text-purple-600 font-semibold">
				Inaccessible links and buttons found ({totalIssues})
			</div>

			{results.rawUrls.length > 0 && (
				<div className="space-y-2">
					<h4 className="text-sm font-semibold text-gray-700">
						URL pasted into text ({results.rawUrls.length})
					</h4>
					<div className="p-3 bg-purple-50 rounded border border-purple-100">
						<ul className="space-y-2 text-sm text-gray-700">
							{results.rawUrls.map((issue, index) => (
								<li key={index} className="break-all">
									<span className="font-mono text-xs bg-purple-100 px-1 py-0.5 rounded">
										{issue.text}
									</span>
								</li>
							))}
						</ul>
					</div>
				</div>
			)}

			{results.vagueLinks.length > 0 && (
				<div className="space-y-2">
					<h4 className="text-sm font-semibold text-gray-700">
						Vague link text ({results.vagueLinks.length})
					</h4>
					<div className="p-3 bg-purple-50 rounded border border-purple-100">
						<ul className="space-y-2 text-sm text-gray-700">
							{results.vagueLinks.map((issue, index) => (
								<li key={index}>
									<span className="font-mono text-xs bg-purple-100 px-1 py-0.5 rounded">
										"{issue.text}"
									</span>
								</li>
							))}
						</ul>
					</div>
				</div>
			)}

			{results.vagueButtons.length > 0 && (
				<div className="space-y-2">
					<h4 className="text-sm font-semibold text-gray-700">
						Vague button text ({results.vagueButtons.length})
					</h4>
					<div className="p-3 bg-purple-50 rounded border border-purple-100">
						<ul className="space-y-2 text-sm text-gray-700">
							{results.vagueButtons.map((issue, index) => (
								<li key={index}>
									<span className="font-mono text-xs bg-purple-100 px-1 py-0.5 rounded">
										"{issue.text}"
									</span>
								</li>
							))}
						</ul>
					</div>
				</div>
			)}

			<div className="text-xs text-gray-600 italic">
				Issues are highlighted in purple on the page.
			</div>
		</div>
	);
};

const TableAccessibilityResultsComponent = ({ results }: { results: TableAccessibilityResults }) => {
	if (!results) {
		return null;
	}
	
	if (results.totalTables === 0) {
		return (
			<div className="p-3 bg-gray-50 text-gray-600 text-sm rounded border border-gray-100">
				There are no tables on this page.
			</div>
		);
	}
	
	if (results.issues.length === 0) {
		return <PassMessage>All tables are accessible!</PassMessage>;
	}

	return (
		<div className="space-y-3">
			<div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-100">
				Found {results.issues.length} table{results.issues.length > 1 ? "s" : ""} with accessibility issues
			</div>

			{results.issues.map((issue, index) => (
				<div key={index} className="space-y-2">
					<h4 className="text-sm font-semibold text-gray-700">
						Table {issue.tableIndex}
					</h4>
					<div className="p-3 bg-red-50 rounded border border-red-100">
						<ul className="space-y-1 text-sm text-gray-700">
							{issue.missingCaption && (
								<li className="flex items-start gap-2">
									<span className="text-red-600 mt-0.5">&times;</span>
									<span>Missing caption - add a title using the "Caption" field in the table editor</span>
								</li>
							)}
							{issue.missingHeaders && (
								<li className="flex items-start gap-2">
									<span className="text-red-600 mt-0.5">&times;</span>
									<span>Missing header row or column - mark the first row or column as headers in the table editor</span>
								</li>
							)}
						</ul>
					</div>
				</div>
			))}

			<div className="text-xs text-gray-600 italic">
				Tables with issues are highlighted in red on the page.
			</div>
		</div>
	);
};

const VideoAccessibilityResultsComponent = ({ results }: { results: VideoAccessibilityResults }) => {
	if (!results) {
		return null;
	}
	
	if (results.totalVideos === 0) {
		return (
			<div className="p-3 bg-gray-50 text-gray-600 text-sm rounded border border-gray-100">
				There are no videos on this page.
			</div>
		);
	}
	
	const hasCaptionIssues = results.issues.length > 0;
	
	return (
		<div className="space-y-3">
			{hasCaptionIssues ? (
				<>
					<div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-100">
						Found {results.issues.length} video{results.issues.length > 1 ? "s" : ""} with caption issues
					</div>

					{results.issues.map((issue, index) => (
						<div key={index} className="space-y-2">
							<h4 className="text-sm font-semibold text-gray-700">
								Video {issue.videoIndex}
							</h4>
							<div className="p-3 bg-red-50 rounded border border-red-100">
								<ul className="space-y-1 text-sm text-gray-700">
									<li className="flex items-start gap-2">
										<span className="text-red-600 mt-0.5">&times;</span>
										<span>No captions detected - ensure the video has a CC button or embedded caption/subtitle tracks</span>
									</li>
								</ul>
								{issue.videoSrc && (
									<div className="mt-2 text-xs text-gray-500 break-all">
										Source: {issue.videoSrc}
									</div>
								)}
							</div>
						</div>
					))}
				</>
			) : (
				!results.hasTranscriptToggle && <PassMessage>Captions were detected for all videos.</PassMessage>
			)}

			{results.hasTranscriptToggle && (
				<div className="p-3 bg-amber-50 text-amber-900 text-sm rounded border border-amber-100">
					Videos with transcripts were detected. Please verify that each transcript accurately and completely reflects the video content.
				</div>
			)}

			{hasCaptionIssues && (
				<div className="text-xs text-gray-600 italic">
					Videos with issues are highlighted in red on the page.
				</div>
			)}
		</div>
	);
};

const ReadabilityScoreResults = ({ result, onCopyText }: { result: ReadabilityScore; onCopyText: () => Promise<void> }) => {
	const [showCopyNotification, setShowCopyNotification] = useState(false);

	if (result.wordCount === 0) {
		return (
			<div className="p-3 bg-gray-50 text-gray-600 text-sm rounded border border-gray-100">
				Not enough text content to analyze.
			</div>
		);
	}

	// determine color based on score
	let scoreColor = "text-green-700";
	let bgColor = "bg-green-50";
	let borderColor = "border-green-100";

	if (result.score > 12) {
		scoreColor = "text-red-700";
		bgColor = "bg-red-50";
		borderColor = "border-red-100";
	} else if (result.score > 10) {
		scoreColor = "text-orange-700";
		bgColor = "bg-orange-50";
		borderColor = "border-orange-100";
	} else if (result.score > 8) {
		scoreColor = "text-amber-700";
		bgColor = "bg-amber-50";
		borderColor = "border-amber-100";
	}

	const handleCompareWithHemingway = async () => {
		try {
			await onCopyText();
			setShowCopyNotification(true);

			trackEvent("hemingway_compare_clicked", {
				readability_score: result.score,
				grade_level: result.gradeLevel
			});
		} catch {
			alert("Failed to copy text to clipboard. Please manually copy the page text and paste it into Hemingway App for comparison.\n\n1. Clear any existing text in Hemingway\n2. Copy text from this page\n3. Paste into Hemingway to compare scores");
		}
	};

	const handleOpenHemingway = () => {
		trackEvent("hemingway_app_opened");
		window.open("https://hemingwayapp.com/", "_blank");
	};

	return (
		<div className="space-y-3">
			{showCopyNotification && (
				<div className="p-4 bg-blue-50 border-2 border-blue-400 rounded relative">
					<button
						onClick={() => setShowCopyNotification(false)}
						className="absolute top-2 right-2 text-blue-600 hover:text-blue-800 font-bold text-lg leading-none"
						aria-label="Dismiss notification"
					>
						×
					</button>
					<div className="font-semibold text-blue-900 mb-3 text-base">✓ Text copied to clipboard!</div>
					<div className="text-sm text-blue-900 space-y-2">
						<div className="bg-blue-100 p-3 rounded border border-blue-300">
							<div className="font-semibold mb-2">Follow these steps in Hemingway App:</div>
							<ol className="list-decimal list-inside space-y-2">
								<li>
									<span className="font-semibold">Clear any existing text</span> in Hemingway App
									<div className="text-xs text-blue-700 ml-5 mt-1">
										(Hemingway may show text from your last session)
									</div>
								</li>
								<li>
									<span className="font-semibold">Paste</span> with Ctrl+V (or Cmd+V on Mac)
								</li>
								<li>
									<span className="font-semibold">Compare</span> the readability scores
								</li>
							</ol>
						</div>
						<div className="text-xs text-blue-700 italic">
							The text from this SF.gov page is already on your clipboard, ready to paste.
						</div>
						<div className="pt-2">
							<Button onClick={handleOpenHemingway}>
								Open Hemingway App
							</Button>
						</div>
					</div>
				</div>
			)}

			<div className={`p-4 ${bgColor} rounded border ${borderColor}`}>
				<div className="flex items-baseline gap-3 mb-2">
					<div className={`text-3xl font-bold ${scoreColor}`}>
						{result.score}
					</div>
					<div className="text-sm font-semibold text-gray-700">
						{result.gradeLevel}
					</div>
				</div>
				<div className="text-sm text-gray-700 mb-2">
					{result.interpretation}
				</div>

				{result.factors && result.factors.length > 0 && (
					<div className="mb-3">
						<ul className="text-sm text-gray-600 space-y-1">
							{result.factors.map((factor, index) => (
								<li key={index} className="flex items-start gap-2">
									<span className="text-gray-400 mt-1">•</span>
									<span>{factor}</span>
								</li>
							))}
						</ul>
					</div>
				)}

				{result.structureIssues && result.structureIssues.length > 0 && (
					<div className="mb-3 pt-3 border-t border-gray-200">
						<div className="text-sm font-semibold text-gray-700 mb-2">Content structure</div>
						<ul className="text-sm text-gray-600 space-y-1">
							{result.structureIssues.map((issue, index) => (
								<li key={index} className="flex items-start gap-2">
									<span className="text-gray-400 mt-1">•</span>
									<span>{issue}</span>
								</li>
							))}
						</ul>
					</div>
				)}

				<div className={`text-sm font-medium ${scoreColor} mb-3`}>
					{result.recommendation}
				</div>

				{result.hasContent && (
					<div className="pt-4 border-t border-gray-200 space-y-2">
						<Button
							onClick={handleCompareWithHemingway}
						>
							Get help in Hemingway App
						</Button>
						<div className="text-xs text-gray-600">
							Hemingway will suggest more ways to make your page easier to read
						</div>
					</div>
				)}
			</div>

			<div className="text-xs text-gray-600 italic">
				Score calculated using adaptive Automated Readability Index, adjusted for sentence complexity. Results will be close to, but may not exactly match, Hemingway App scores.
			</div>
		</div>
	);
};

// ─── types ──────────────────────────────────────────────────────────────

interface A11yResults {
	headings: HeadingNestingIssue[];
	images: ImageAltTextInfo[];
	links: LinkAccessibilityResults;
	tables: TableAccessibilityResults | null;
	videos: VideoAccessibilityResults | null;
	readability: ReadabilityScore | null;
}

const emptyResults: A11yResults = {
	headings: [],
	images: [],
	links: emptyLinkResults,
	tables: null,
	videos: null,
	readability: null,
};

// ─── highlight helpers (run in page context) ────────────────────────────

function clearAllHighlights() {
	// heading highlights
	document.querySelectorAll("[data-a11y-heading-issue]").forEach(el => {
		el.removeAttribute("data-a11y-heading-issue");
		if (el instanceof HTMLElement) {
			el.style.backgroundColor = "";
			el.style.outline = "";
		}
	});
	// table highlights
	document.querySelectorAll("[data-a11y-table-issue]").forEach(el => {
		el.removeAttribute("data-a11y-table-issue");
		if (el instanceof HTMLElement) {
			el.style.outline = "";
			el.style.outlineOffset = "";
		}
	});
	// video highlights
	document.querySelectorAll("[data-a11y-video-issue]").forEach(el => {
		el.removeAttribute("data-a11y-video-issue");
		if (el instanceof HTMLElement) {
			el.style.outline = "";
			el.style.outlineOffset = "";
		}
	});
	// link highlights are cleaned up by checkLinkAccessibility itself
}

function applyHighlights() {
	// heading highlights
	document.querySelectorAll("[data-a11y-heading-issue]").forEach(el => {
		if (el instanceof HTMLElement) {
			el.style.backgroundColor = "yellow";
			el.style.outline = "2px solid orange";
		}
	});
	// link highlights
	document.querySelectorAll("[data-a11y-link-issue]").forEach(el => {
		if (el instanceof HTMLElement) {
			el.style.outline = "2px solid #9b59b6";
			el.style.outlineOffset = "2px";
		}
	});
	// table highlights
	document.querySelectorAll("[data-a11y-table-issue]").forEach(el => {
		if (el instanceof HTMLElement) {
			el.style.outline = "3px solid #dc2626";
			el.style.outlineOffset = "2px";
		}
	});
	// video highlights
	document.querySelectorAll("[data-a11y-video-issue]").forEach(el => {
		if (el instanceof HTMLElement) {
			el.style.outline = "3px solid #dc2626";
			el.style.outlineOffset = "2px";
		}
	});
}

// ─── main component ─────────────────────────────────────────────────────

interface A11yCheckerProps {
	pageUrl: string;
	images: MediaAsset[];
	buttonText?: string;
	onCheckStart?: () => void;
	onCheckComplete?: () => void;
	onCheckError?: (error: string) => void;
	onMissingAltTextUrls?: (urls: Set<string>) => void;
}

export function A11yChecker({
	pageUrl,
	images,
	buttonText = "Run accessibility tests",
	onCheckStart,
	onCheckComplete,
	onCheckError,
	onMissingAltTextUrls,
}: A11yCheckerProps) {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [hasRun, setHasRun] = useState(false);
	const [results, setResults] = useState<A11yResults>(emptyResults);

	// clear results when page URL changes
	useEffect(() => {
		setResults(emptyResults);
		setError(null);
		onMissingAltTextUrls?.(new Set());
	}, [pageUrl]);

	const handleRunCheck = async () => {
		setIsLoading(true);
		setError(null);
		setHasRun(false);
		setResults(emptyResults);

		onCheckStart?.();

		const startTime = Date.now();

		try {
			const [tab] = await chrome.tabs.query({
				active: true,
				currentWindow: true,
			});

			if (!tab?.id) {
				throw new Error("No active tab found");
			}

			const tabId = tab.id;

			// clean up any previous highlights
			await executeInTab(tabId, clearAllHighlights);

			// run all checks in parallel
			const [headings, altText, linkData, tableData, videoData, readability] = await Promise.all([
				executeInTab(tabId, checkHeadingNesting),
				executeInTab(tabId, checkImageAltText),
				executeInTab(tabId, checkLinkAccessibility),
				executeInTab(tabId, checkTableAccessibility),
				executeInTab(tabId, checkVideoAccessibility),
				executeInTab(tabId, calculateReadabilityScore),
			]);

			// apply all highlights in one pass
			await executeInTab(tabId, applyHighlights);

			const finalResults = {
				headings: headings ?? [],
				images: altText ?? [],
				links: linkData ?? emptyLinkResults,
				tables: tableData ?? { totalTables: 0, issues: [] },
				videos: videoData ?? { totalVideos: 0, issues: [], hasTranscriptToggle: false },
				readability: readability ?? null,
			};

			setResults(finalResults);

			// notify parent of which image URLs are missing alt text (excluding decorative images)
			if (onMissingAltTextUrls) {
				const decorativeUrls = new Set(images.filter(img => img.isDecorative).map(img => img.url));
				const missingUrls = new Set(
					(altText ?? [])
						.filter(info => !info.hasAltText && !decorativeUrls.has(info.url))
						.map(info => info.url)
				);
				onMissingAltTextUrls(missingUrls);
			}

			const duration = Date.now() - startTime;

			// track successful a11y check
			const decorativeUrls = new Set(images.filter(img => img.isDecorative).map(img => img.url));
			const missingAltCount = (altText ?? []).filter(info => !info.hasAltText && !decorativeUrls.has(info.url)).length;
			const linkIssuesCount = (linkData?.rawUrls.length ?? 0) + (linkData?.vagueLinks.length ?? 0) + (linkData?.vagueButtons.length ?? 0);

			trackEvent("a11y_check_completed", {
				page_url: pageUrl,
				duration_ms: duration,
				heading_issues: finalResults.headings.length,
				missing_alt_text: missingAltCount,
				link_issues: linkIssuesCount,
				table_issues: finalResults.tables?.issues.length ?? 0,
				video_issues: finalResults.videos?.issues.length ?? 0,
				readability_score: finalResults.readability?.score ?? null,
				total_issues: finalResults.headings.length + missingAltCount + linkIssuesCount + (finalResults.tables?.issues.length ?? 0) + (finalResults.videos?.issues.length ?? 0)
			});

			setHasRun(true);
			setIsLoading(false);
			onCheckComplete?.();
		} catch (err) {
			console.error("Accessibility check failed:", err);
			const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
			setError(errorMessage);
			setIsLoading(false);
			onCheckError?.(errorMessage);

			trackError("a11y_check_error", err instanceof Error ? err : new Error(errorMessage), {
				page_url: pageUrl
			});
		}
	};

	/** extract page text on-demand and copy to clipboard */
	const handleCopyPageText = async () => {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});

		if (!tab?.id) {
			throw new Error("No active tab found");
		}

		const text = await executeInTab(tab.id, extractPageText);

		if (!text) {
			throw new Error("No text could be extracted from the page");
		}

		await navigator.clipboard.writeText(text);
	};

//	const hasHeadingIssues = results.headings.length > 0;
//	const hasImageIssues = results.images.some(info => !info.hasAltText);
//	const hasLinkIssues = results.links.rawUrls.length + results.links.vagueLinks.length + results.links.vagueButtons.length > 0;
//	const hasTables = results.tables && results.tables.totalTables > 0;
//	const hasVideos = results.videos && results.videos.totalVideos > 0;

	return (
		<div className="space-y-4">
			<Button
				onClick={handleRunCheck}
				disabled={isLoading}
				className="self-start"
			>
				{isLoading ? <><SpinnerIcon /> Running tests...</> : buttonText}
			</Button>

			{error && (
				<div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-100">
					{error}
				</div>
			)}

			{hasRun && !error && (
				<div className="space-y-6">
					{/*{hasHeadingIssues && (*/}
						<div>
							<h3 className="text-sm font-semibold text-gray-700 mb-3">Heading nesting</h3>
							<HeadingNestingResults issues={results.headings} />
						</div>
					{/*)}*/}

					{/*{hasImageIssues && (*/}
						<div>
							<h3 className="text-sm font-semibold text-gray-700 mb-3">Image alt text</h3>
							<ImageAltTextResults results={results.images} apiImages={images} />
						</div>
					{/*)}*/}

					{/*{hasLinkIssues && (*/}
						<div>
							<h3 className="text-sm font-semibold text-gray-700 mb-3">Inaccessible links</h3>
							<LinkAccessibilityResultsComponent results={results.links} />
						</div>
					{/*)}*/}

					{/*{hasTables && (*/}
						<div>
							<h3 className="text-sm font-semibold text-gray-700 mb-3">Table accessibility</h3>
							<TableAccessibilityResultsComponent results={results.tables!} />
						</div>
					{/*)}*/}

					{/*{hasVideos && (*/}
						<div>
							<h3 className="text-sm font-semibold text-gray-700 mb-3">Video accessibility</h3>
							<VideoAccessibilityResultsComponent results={results.videos!} />
						</div>
					{/*)}*/}

					{results.readability && (
						<div>
							<h3 className="text-sm font-semibold text-gray-700 mb-3">Readability score</h3>
							<ReadabilityScoreResults result={results.readability} onCopyText={handleCopyPageText} />
						</div>
					)}
				</div>
			)}
		</div>
	);
}
