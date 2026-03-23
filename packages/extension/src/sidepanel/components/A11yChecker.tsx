import { useState, useEffect } from "react";
import { Button } from "./Button";
import { 
	checkHeadingNesting, 
	checkImageAltText, 
	checkLinkAccessibility,
	checkTableAccessibility,
	checkVideoAccessibility,
	calculateReadabilityScore,
	type HeadingNestingIssue, 
	type ImageAltTextInfo,
	type LinkAccessibilityResults,
	type TableAccessibilityResults,
	type VideoAccessibilityResults,
	type ReadabilityScore,
} from "@/lib/a11y-check";
import type { MediaAsset } from "@sf-gov/shared";

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

const HeadingNestingResults = ({ issues }: { issues: HeadingNestingIssue[] }) => {
	if (issues.length === 0) {
		return (
			<div className="p-3 bg-green-50 text-green-700 text-sm rounded border border-green-100">
				All headings are properly nested!
			</div>
		);
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

const LinkAccessibilityResultsComponent = ({ results }: { results: LinkAccessibilityResults }) => {
	const totalIssues = results.rawUrls.length + results.vagueLinks.length + results.vagueButtons.length;
	
	if (totalIssues === 0) {
		return (
			<div className="p-3 bg-green-50 text-green-700 text-sm rounded border border-green-100">
				All links and buttons are accessible!
			</div>
		);
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

const TableAccessibilityResultsComponent = ({ results }: { results: TableAccessibilityResults | null }) => {
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
		return (
			<div className="p-3 bg-green-50 text-green-700 text-sm rounded border border-green-100">
				All tables are accessible!
			</div>
		);
	}
	
	return (
		<div className="space-y-3">
			<div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-100">
				Found {results.issues.length} table{results.issues.length > 1 ? 's' : ''} with accessibility issues
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
									<span className="text-red-600 mt-0.5">✗</span>
									<span>Missing caption - add a title using the "Caption" field in the table editor</span>
								</li>
							)}
							{issue.missingHeaders && (
								<li className="flex items-start gap-2">
									<span className="text-red-600 mt-0.5">✗</span>
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

const VideoAccessibilityResultsComponent = ({ results }: { results: VideoAccessibilityResults | null }) => {
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
	
	if (results.issues.length === 0) {
		return (
			<div className="p-3 bg-green-50 text-green-700 text-sm rounded border border-green-100">
				Captions and transcripts were detected for all videos. Please verify that transcripts accurately reflect the video content.
			</div>
		);
	}
	
	return (
		<div className="space-y-3">
			<div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-100">
				Found {results.issues.length} video{results.issues.length > 1 ? 's' : ''} with accessibility issues
			</div>
			
			{results.issues.map((issue, index) => (
				<div key={index} className="space-y-2">
					<h4 className="text-sm font-semibold text-gray-700">
						Video {issue.videoIndex}
					</h4>
					<div className="p-3 bg-red-50 rounded border border-red-100">
						<ul className="space-y-1 text-sm text-gray-700">
							{issue.missingCaptions && (
								<li className="flex items-start gap-2">
									<span className="text-red-600 mt-0.5">✗</span>
									<span>No captions detected - ensure the video has a CC button or embedded caption/subtitle tracks</span>
								</li>
							)}
							{issue.missingTranscript && (
								<li className="flex items-start gap-2">
									<span className="text-red-600 mt-0.5">✗</span>
									<span>No transcript detected - a "Show transcript" toggle may be present, but no transcript content was found. Add transcript text to the video's transcript field.</span>
								</li>
							)}
						</ul>
						<p className="mt-2 text-xs text-gray-500 italic">
							Note: this check only detects the presence of a transcript, not whether it accurately reflects the video content. Please review transcripts manually.
						</p>
						{issue.videoSrc && (
							<div className="mt-2 text-xs text-gray-500 break-all">
								Source: {issue.videoSrc}
							</div>
						)}
					</div>
				</div>
			))}
			
			<div className="text-xs text-gray-600 italic">
				Videos with issues are highlighted in red on the page.
			</div>
		</div>
	);
};

const ReadabilityScoreResults = ({ result }: { result: ReadabilityScore | null }) => {
	const [showCopyNotification, setShowCopyNotification] = useState(false);
	
	if (!result) {
		return (
			<div className="p-3 bg-gray-50 text-gray-600 text-sm rounded border border-gray-100">
				Unable to calculate readability score.
			</div>
		);
	}
	
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
	
	const handleCompareWithHemingway = () => {
		if (!result.extractedText) {
			console.error("No extracted text available for comparison");
			return;
		}
		
		const text = result.extractedText;
		
		// copy to clipboard and show notification in the side panel
		navigator.clipboard.writeText(text).then(() => {
			// show notification with instructions
			setShowCopyNotification(true);
		}).catch(() => {
			// fallback: show alert with instructions
			alert("Failed to copy text to clipboard. Please manually copy the page text and paste it into Hemingway App for comparison.\n\n1. Clear any existing text in Hemingway\n2. Copy text from this page\n3. Paste into Hemingway to compare scores");
		});
	};
	
	const handleOpenHemingway = () => {
		window.open("https://hemingwayapp.com/", "_blank");
	};
	
	const handleDismissNotification = () => {
		setShowCopyNotification(false);
	};
	
	return (
		<div className="space-y-3">
			{showCopyNotification && (
				<div className="p-4 bg-blue-50 border-2 border-blue-400 rounded-lg relative">
					<button
						onClick={handleDismissNotification}
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
							<button
								onClick={handleOpenHemingway}
								className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-sm"
							>
								Open Hemingway App
							</button>
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
				
				{result.extractedText && (
					<div className="pt-2 border-t border-gray-200 space-y-2">
						<Button
							onClick={handleCompareWithHemingway}
							className="text-xs px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white"
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
				Score calculated using adaptive Automated Readability Index, adjusted for sentence complexity. Results will be close to, but may not exactly match, Hemingway App scores. SF.gov aims for 8th grade level or lower for accessibility.
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

	const missingAltText = results.filter(info => !info.hasAltText);
	
	if (missingAltText.length === 0) {
		return (
			<div className="p-3 bg-green-50 text-green-700 text-sm rounded border border-green-100">
				All images have alt text!
			</div>
		);
	}

	// create a set of API image URLs for comparison
	const apiImageUrls = new Set(apiImages.map(img => img.url));
	
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
							<>
								Look for the{" "}
								<span className="text-amber-600 shrink-0">
									<svg 
										className="w-4 h-4 inline" 
										fill="currentColor" 
										viewBox="0 0 20 20"
										xmlns="http://www.w3.org/2000/svg"
									>
										<path 
											fillRule="evenodd" 
											d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" 
											clipRule="evenodd" 
										/>
									</svg>
								</span>
								{" "}under Images and documents.
							</>
						)}
					</span>
				</p>
			</div>
			
			{imagesNotInApi.length > 0 && (
				<div className="p-3 bg-amber-50 text-amber-900 text-sm rounded border border-amber-100">
					<p className="font-semibold mb-2">
						Images not listed in "Images and documents":
					</p>
					<ul className="list-disc list-inside space-y-1 text-xs">
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

interface A11yCheckerProps {
	pageUrl: string;
	images: MediaAsset[];
	buttonText?: string;
	onCheckStart?: () => void;
	onCheckComplete?: () => void;
	onCheckError?: (error: string) => void;
}

export function A11yChecker({
	pageUrl,
	images,
	buttonText = "Run accessibility tests",
	onCheckStart,
	onCheckComplete,
	onCheckError,
}: A11yCheckerProps) {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [hasRun, setHasRun] = useState(false);
	const [headingIssues, setHeadingIssues] = useState<HeadingNestingIssue[]>([]);
	const [imageAltTextResults, setImageAltTextResults] = useState<ImageAltTextInfo[]>([]);
	const [linkAccessibilityResults, setLinkAccessibilityResults] = useState<LinkAccessibilityResults>({
		rawUrls: [],
		vagueLinks: [],
		vagueButtons: [],
	});
	const [tableAccessibilityResults, setTableAccessibilityResults] = useState<TableAccessibilityResults | null>(null);
	const [videoAccessibilityResults, setVideoAccessibilityResults] = useState<VideoAccessibilityResults | null>(null);
	const [readabilityScore, setReadabilityScore] = useState<ReadabilityScore | null>(null);

	// clear results when page URL changes, but keep readability score and notification
	useEffect(() => {
		setHeadingIssues([]);
		setImageAltTextResults([]);
		setLinkAccessibilityResults({ rawUrls: [], vagueLinks: [], vagueButtons: [] });
		setTableAccessibilityResults(null);
		setVideoAccessibilityResults(null);
		// don't clear readabilityScore or hasRun so notification persists
		setError(null);
	}, [pageUrl]);

	const handleRunCheck = async () => {
		console.log("A11yChecker: handleRunCheck called");
		setIsLoading(true);
		setError(null);
		setHasRun(false);
		setHeadingIssues([]);
		setImageAltTextResults([]);
		setLinkAccessibilityResults({ rawUrls: [], vagueLinks: [], vagueButtons: [] });
		setTableAccessibilityResults(null);
		setVideoAccessibilityResults(null);
		setReadabilityScore(null);

		onCheckStart?.();

		try {
			const [tab] = await chrome.tabs.query({
				active: true,
				currentWindow: true,
			});

			if (!tab?.id) {
				throw new Error("No active tab found");
			}

			// check heading nesting
			const nestingResults = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: checkHeadingNesting,
			});

			const issues = nestingResults[0]?.result as HeadingNestingIssue[] | undefined;

			if (issues && issues.length > 0) {
				setHeadingIssues(issues);

				// highlight the problematic headings on the page
				await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					func: (issueTexts: string[]) => {
						const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
						headings.forEach(heading => {
							const text = heading.textContent?.trim() || "";
							if (issueTexts.includes(text)) {
								if (heading instanceof HTMLElement) {
									heading.style.backgroundColor = "yellow";
									heading.style.outline = "2px solid orange";
								}
							}
						});
					},
					args: [issues.map(issue => issue.toText)],
				});
			} else {
				setHeadingIssues([]);
			}

			// check image alt text for all images on the page (excluding header/footer)
			const altTextResults = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: checkImageAltText,
			});

			const altTextInfo = altTextResults[0]?.result as ImageAltTextInfo[] | undefined;
			if (altTextInfo) {
				setImageAltTextResults(altTextInfo);
			}

			// check link accessibility
			const linkResults = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: checkLinkAccessibility,
			});

			const linkIssues = linkResults[0]?.result as LinkAccessibilityResults | undefined;
			if (linkIssues) {
				setLinkAccessibilityResults(linkIssues);

				// highlight the problematic links and buttons on the page
				const allIssues = [...linkIssues.rawUrls, ...linkIssues.vagueLinks, ...linkIssues.vagueButtons];
				if (allIssues.length > 0) {
					await chrome.scripting.executeScript({
						target: { tabId: tab.id },
						func: () => {
							// find all elements that were flagged (stored in a data attribute by checkLinkAccessibility)
							const flaggedElements = document.querySelectorAll("[data-a11y-link-issue]");
							flaggedElements.forEach(el => {
								if (el instanceof HTMLElement) {
									el.style.outline = "2px solid #9b59b6";
									el.style.outlineOffset = "2px";
								}
							});
						},
					});
				}
			}

			// check table accessibility
			const tableResults = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: checkTableAccessibility,
			});

			const tableData = tableResults[0]?.result as TableAccessibilityResults | undefined;
			console.log("Table check results:", tableData);
			
			if (tableData) {
				setTableAccessibilityResults(tableData);

				// highlight the problematic tables on the page
				if (tableData.issues.length > 0) {
					await chrome.scripting.executeScript({
						target: { tabId: tab.id },
						func: () => {
							// find all tables that were flagged (stored in a data attribute by checkTableAccessibility)
							const flaggedTables = document.querySelectorAll("[data-a11y-table-issue]");
							flaggedTables.forEach(table => {
								if (table instanceof HTMLElement) {
									table.style.outline = "3px solid #dc2626";
									table.style.outlineOffset = "2px";
								}
							});
						},
					});
				}
			} else {
				// if no results returned, assume no tables
				setTableAccessibilityResults({ totalTables: 0, issues: [] });
			}

			// check video accessibility
			const videoResults = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: checkVideoAccessibility,
			});

			const videoData = videoResults[0]?.result as VideoAccessibilityResults | undefined;
			console.log("Video check results:", videoData);
			
			if (videoData) {
				setVideoAccessibilityResults(videoData);

				// highlight the problematic videos on the page
				if (videoData.issues.length > 0) {
					await chrome.scripting.executeScript({
						target: { tabId: tab.id },
						func: () => {
							// find all videos that were flagged (stored in a data attribute by checkVideoAccessibility)
							const flaggedVideos = document.querySelectorAll("[data-a11y-video-issue]");
							flaggedVideos.forEach(video => {
								if (video instanceof HTMLElement) {
									video.style.outline = "3px solid #dc2626";
									video.style.outlineOffset = "2px";
								}
							});
						},
					});
				}
			} else {
				// if no results returned, assume no videos
				setVideoAccessibilityResults({ totalVideos: 0, issues: [] });
			}

			// calculate readability score
			const readabilityResults = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: calculateReadabilityScore,
			});

			const readability = readabilityResults[0]?.result as ReadabilityScore | undefined;
			if (readability) {
				setReadabilityScore(readability);
			}

			setHasRun(true);
			setIsLoading(false);
			onCheckComplete?.();
		} catch (err) {
			console.error("Accessibility check failed:", err);
			const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
			setError(errorMessage);
			setIsLoading(false);
			onCheckError?.(errorMessage);
		}
	};

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
					<div>
						<h3 className="text-sm font-semibold text-gray-700 mb-3">Heading nesting</h3>
						<HeadingNestingResults issues={headingIssues} />
					</div>

					<div>
						<h3 className="text-sm font-semibold text-gray-700 mb-3">Image alt text</h3>
						<ImageAltTextResults results={imageAltTextResults} apiImages={images} />
					</div>

					<div>
						<h3 className="text-sm font-semibold text-gray-700 mb-3">Inaccessible links</h3>
						<LinkAccessibilityResultsComponent results={linkAccessibilityResults} />
					</div>

					<div>
						<h3 className="text-sm font-semibold text-gray-700 mb-3">Table accessibility</h3>
						<TableAccessibilityResultsComponent results={tableAccessibilityResults} />
					</div>

					<div>
						<h3 className="text-sm font-semibold text-gray-700 mb-3">Video accessibility</h3>
						<VideoAccessibilityResultsComponent results={videoAccessibilityResults} />
					</div>

					<div>
						<h3 className="text-sm font-semibold text-gray-700 mb-3">Readability score</h3>
						<ReadabilityScoreResults result={readabilityScore} />
					</div>
				</div>
			)}
		</div>
	);
}
