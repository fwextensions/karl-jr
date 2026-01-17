import { useState, useEffect } from "react";
import { extractContentLinks, type LinkInfo } from "../../lib/link-check";
import { LinkCheckClient } from "../../api/link-check-client";
import { Button } from "./Button";
import { Card } from "./Card";
import {
	type LinkCheckResult,
	getCachedResults,
	setCachedResults,
	clearLinkCheckerCache,
} from "../lib/link-checker-cache";
import { trackEvent, trackError, identifyUser } from "@/lib/analytics";

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

const ProgressBar = ({ checked, total }: { checked: number; total: number }) => {
	const percentage = total > 0 ? (checked / total) * 100 : 0;
	
	return (
		<div className="mt-3">
			<div className="flex justify-between text-sm text-gray-600 mb-1">
				<span>Checking links...</span>
				<span>{checked} / {total}</span>
			</div>
			<div className="w-full bg-gray-200 rounded-full h-2">
				<div
					className="bg-sfgov-blue h-2 rounded-full transition-all duration-300"
					style={{ width: `${percentage}%` }}
				></div>
			</div>
		</div>
	);
};

const IssueItem = ({ result }: { result: LinkCheckResult }) => (
	<div className="p-3 bg-gray-50 rounded border border-gray-100 text-sm">
		<div className="font-medium text-gray-900 mb-1 flex items-center gap-2">
			<span className={
				result.status === "broken" ? "text-red-600" :
				result.status === "timeout" ? "text-yellow-600" :
				result.status === "warning" ? "text-orange-500" :
				result.status === "insecure" ? "text-amber-600" :
				result.status === "redirect" ? "text-blue-600" :
				"text-orange-600"
			}>
				{result.status === "broken" && `${result.statusCode || "Error"}`}
				{result.status === "timeout" && "Timeout"}
				{result.status === "error" && "Error"}
				{result.status === "warning" && "Warning"}
				{result.status === "insecure" && "Insecure"}
				{result.status === "redirect" && "Redirect"}
			</span>
		</div>
		{result.text && (
			<div className="text-gray-600 mb-1">
				<span className="font-medium">Text:</span> {result.text}
			</div>
		)}
		<div className="text-gray-600 break-all">
			<span className="font-medium">URL:</span>{" "}
			<a href={result.url} target="_blank" rel="noopener noreferrer" className="text-sfgov-blue hover:underline">
				{result.url}
			</a>
		</div>
		{result.finalUrl && result.status === "redirect" && (
			<div className="text-gray-600 break-all mt-1">
				<span className="font-medium">Final URL:</span>{" "}
				<a href={result.finalUrl} target="_blank" rel="noopener noreferrer" className="text-sfgov-blue hover:underline">
					{result.finalUrl}
				</a>
			</div>
		)}
		{result.error && (
			<div className="text-gray-500 text-xs mt-1">{result.error}</div>
		)}
	</div>
);

const Results = ({ results, totalChecked }: { results: LinkCheckResult[]; totalChecked: number }) => {
	const brokenLinks = results.filter(r => r.status === "broken" || r.status === "timeout" || r.status === "error");
	const warningLinks = results.filter(r => r.status === "warning");
	const insecureLinks = results.filter(r => r.status === "insecure");
	const redirectLinks = results.filter(r => r.status === "redirect");
	const issueCount = brokenLinks.length + warningLinks.length + insecureLinks.length;

	return (
		<div className="mt-4 space-y-3">
			<div className="text-sm text-gray-500 font-medium">
				Checked {totalChecked} link{totalChecked === 1 ? "" : "s"}, found {issueCount} issue{issueCount === 1 ? "" : "s"}:
				</div>
			{brokenLinks.length > 0 && (
				<div className="space-y-2 pr-1">
					{brokenLinks.map((result, index) => (
						<IssueItem key={index} result={result} />
					))}
				</div>
			)}
			{warningLinks.length > 0 && (
				<div className="space-y-2 mt-4 pr-1">
					{warningLinks.map((result, index) => (
						<IssueItem key={`warning-${index}`} result={result} />
					))}
				</div>
			)}
			{insecureLinks.length > 0 && (
				<>
{/*
					<div className="text-sm text-amber-600 font-medium mt-3">
						{insecureLinks.length} insecure (HTTP) link{insecureLinks.length === 1 ? "" : "s"}
					</div>
*/}
					<div className="space-y-2 mt-4 pr-1">
						{insecureLinks.map((result, index) => (
							<IssueItem key={`insecure-${index}`} result={result} />
						))}
					</div>
				</>
			)}
			{redirectLinks.length > 0 && (
				<>
{/*
					<div className="text-sm text-blue-600 font-medium mt-3">
						{redirectLinks.length} redirect{redirectLinks.length === 1 ? "" : "s"} (informational)
					</div>
*/}
					<div className="space-y-2 mt-4 pr-1">
						{redirectLinks.map((result, index) => (
							<IssueItem key={`redirect-${index}`} result={result} />
						))}
					</div>
				</>
			)}
		</div>
	);
};

interface LinkCheckerCardProps {
	pageUrl: string;
}

export function LinkCheckerCard({ pageUrl }: LinkCheckerCardProps)
{
	const [results, setResults] = useState<LinkCheckResult[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [hasRun, setHasRun] = useState(false);
	const [progress, setProgress] = useState({ checked: 0, total: 0 });
	const [linkCheckClient] = useState(() => new LinkCheckClient());

	// restore cached results when pageUrl changes
	useEffect(() => {
		const cached = getCachedResults(pageUrl);
		if (cached) {
			setResults(cached);
			setHasRun(true);
		} else {
			setResults([]);
			setHasRun(false);
		}
		setError(null);
	}, [pageUrl]);

	// cleanup on unmount
	useEffect(() => {
		return () => {
			linkCheckClient.abort();
		};
	}, [linkCheckClient]);

	const handleRunCheck = async () => {
		console.log("LinkCheckerCard: handleRunCheck called");
		clearLinkCheckerCache(pageUrl);
		setIsLoading(true);
		setError(null);
		setResults([]);
		setHasRun(false);
		setProgress({ checked: 0, total: 0 });

		const startTime = Date.now();

		try {
			const [tab] = await chrome.tabs.query({
				active: true,
				currentWindow: true,
			});

			if (!tab?.id) {
				throw new Error("No active tab found");
			}

			// extract links from the page
			const injectionResults = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: extractContentLinks,
			});

			const links = injectionResults[0]?.result as LinkInfo[] | undefined;
			if (!links || links.length === 0) {
				setHasRun(true);
				setIsLoading(false);
				return;
			}

			// track link check start
			trackEvent("link_check_started", {
				page_url: pageUrl,
				link_count: links.length
			});

			// identify user since they're authenticated (link check requires auth)
			identifyUser();

			// create a map of URL to link text for later reference
			const linkTextMap = new Map<string, string>();
			links.forEach(link => {
				linkTextMap.set(link.url, link.text);
			});

			setProgress({ checked: 0, total: links.length });

			// start server-side link check with streaming results
			console.log("LinkCheckerCard: Starting link check with", links.length, "links");
			await linkCheckClient.startCheck({
				urls: links.map(l => l.url),
				pageUrl,
				onResult: (result) => {
					// add link text to result
					const linkResult: LinkCheckResult = {
						...result,
						text: linkTextMap.get(result.url) || "",
					};

					// update results incrementally
					setResults(prev => [...prev, linkResult]);
					setProgress(prev => ({ ...prev, checked: prev.checked + 1 }));
				},
				onComplete: (_summary, serverResults) => {
					console.log("[LinkChecker] onComplete callback fired, results:", serverResults.length);

					// add link text to results and update state
					const finalResults: LinkCheckResult[] = serverResults.map(result => ({
						...result,
						text: linkTextMap.get(result.url) || "",
					}));

					setResults(finalResults);
					setCachedResults(pageUrl, finalResults);
					setHasRun(true);
					setIsLoading(false);

					// track completion
					const duration = Date.now() - startTime;
					const brokenLinks = finalResults.filter(r =>
						r.status === "broken" || r.status === "timeout" || r.status === "error"
					).length;
					const insecureLinks = finalResults.filter(r => r.status === "insecure").length;

					trackEvent("link_check_completed", {
						page_url: pageUrl,
						total_links: finalResults.length,
						broken_links: brokenLinks,
						insecure_links: insecureLinks,
						duration_ms: duration
					});
				},
				onError: (errorMessage) => {
					setError(errorMessage);
					setIsLoading(false);

					// track link check error
					trackError("link_check_error", new Error(errorMessage), {
						page_url: pageUrl,
						link_count: links.length
					});
				},
			});
		} catch (err) {
			console.error("Link check failed:", err);
			const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
			setError(errorMessage);
			setIsLoading(false);

			// track link check error
			trackError("link_check_error", err as Error, {
				page_url: pageUrl
			});
		}
	};

	const brokenCount = results.filter(r => r.status === "broken" || r.status === "timeout" || r.status === "error").length;
	const warningCount = results.filter(r => r.status === "warning").length;
	const insecureCount = results.filter(r => r.status === "insecure").length;
	const issueCount = brokenCount + warningCount + insecureCount;

	return (
		<Card title="Broken Link Finder">
			<Button
				onClick={handleRunCheck}
				disabled={isLoading}
				className="self-start"
			>
				{isLoading ? <><SpinnerIcon /> Checking...</> : "Run Check"}
			</Button>

			{error && (
				<div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded border border-red-100">
					{error}
				</div>
			)}

			{isLoading && progress.total > 0 && (
				<ProgressBar checked={progress.checked} total={progress.total} />
			)}

			{hasRun && results.length === 0 && !error && (
				<div className="mt-4 p-3 bg-gray-50 text-gray-600 text-sm rounded border border-gray-100">
					No links found in the main content area.
				</div>
			)}

			{hasRun && results.length > 0 && issueCount === 0 && !error && (
				<div className="mt-4 p-3 bg-green-50 text-green-700 text-sm rounded border border-green-100">
					All {results.length} link{results.length === 1 ? "" : "s"} are working!
				</div>
			)}

			{results.length > 0 && issueCount > 0 && (
				<Results results={results} totalChecked={results.length} />
			)}
		</Card>
	);
}
