import { useState, useEffect } from "react";
import { Button } from "./Button";
import { checkHeadingNesting, type HeadingNestingIssue } from "@/lib/a11y-check";

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

interface A11yCheckerProps {
	pageUrl: string;
	buttonText?: string;
	onCheckStart?: () => void;
	onCheckComplete?: () => void;
	onCheckError?: (error: string) => void;
}

export function A11yChecker({
	pageUrl,
	buttonText = "Run accessibility tests",
	onCheckStart,
	onCheckComplete,
	onCheckError,
}: A11yCheckerProps) {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [hasRun, setHasRun] = useState(false);
	const [headingIssues, setHeadingIssues] = useState<HeadingNestingIssue[]>([]);

	// clear results when page URL changes
	useEffect(() => {
		setHeadingIssues([]);
		setHasRun(false);
		setError(null);
	}, [pageUrl]);

	const handleRunCheck = async () => {
		console.log("A11yChecker: handleRunCheck called");
		setIsLoading(true);
		setError(null);
		setHasRun(false);
		setHeadingIssues([]);

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
				<div>
					<h3 className="text-sm font-semibold text-gray-700 mb-3">Heading nesting</h3>
					<HeadingNestingResults issues={headingIssues} />
				</div>
			)}
		</div>
	);
}
