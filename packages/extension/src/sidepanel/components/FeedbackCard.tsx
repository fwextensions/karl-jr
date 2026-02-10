import React, { useState, useEffect, useRef } from "react";
import type { FeedbackRecord, FeedbackStats, AirtableApiError } from "@sf-gov/shared";
import { getFeedback, clearCache } from "@/api/airtable-client";
import { Button } from "@/sidepanel/components/Button.tsx";
import { Card } from "@/sidepanel/components/Card.tsx";
import { trackEvent } from "@/lib/analytics";

interface FeedbackCardProps {
	pagePath: string;
}

interface FeedbackItemProps {
	record: FeedbackRecord;
}

const FeedbackItem: React.FC<FeedbackItemProps> = ({ record }) => {
	// format date to readable format
	const formatDate = (dateString: string): string => {
		try {
			const date = new Date(dateString);
			return date.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
			});
		} catch {
			return dateString;
		}
	};

	return (
		<div className="border-b border-gray-200 pb-4 last:border-b-0 last:pb-0">
			{/* header: date and helpfulness */}
			<div className="flex items-center justify-between mb-2 text-xs text-gray-500">
				<div className="">
					{formatDate(record.submissionCreated)}
				</div>
				{record.wasHelpful && (
					<div>
						{/*User vote:*/}
						<div
							title="User's rating of this page"
							className={`inline-block text-xs font-medium ml-2 px-2 py-1 rounded ${record.wasHelpful === "yes"
									? "bg-green-100 text-green-800"
									: "bg-orange-100 text-orange-800"
								}`}
						>
							{record.wasHelpful === "yes" ? "👍 Helpful" : "👎 Not Helpful"}
						</div>
					</div>
				)}
			</div>

			{/* issue category (if not helpful) */}
			{record.wasHelpful === "no" && record.issueCategory && (
				<div className="text-sm mb-2">
					<span className="font-medium text-gray-700">Issue: </span>
					<span className="text-gray-900">{record.issueCategory}</span>
				</div>
			)}

			{/* what was helpful (if helpful) */}
			{record.wasHelpful === "yes" && record.whatWasHelpful && (
				<div className="text-sm mb-2">
					<span className="font-medium text-gray-700">What was helpful: </span>
					<span className="text-gray-900">{record.whatWasHelpful}</span>
				</div>
			)}

			{/* additional details */}
			{record.additionalDetails && (
				<div className="text-sm mb-2">
					<span className="font-medium text-gray-700">Details: </span>
					<span className="text-gray-900">{record.additionalDetails}</span>
				</div>
			)}

			{/* submission ID (small, at bottom) */}
			<div className="text-xs text-gray-400 mt-2">
				ID:{" "}
				<a
					href={`https://airtable.com/appo4SjothLkSxmbG/tblbhivrMRm5X8eSU/viwgRjwYR6z9CsRc2/${record.id}`}
					target="_blank"
					rel="noopener noreferrer"
					title=""
					className="text-gray-400 no-underline cursor-default"
				>
					{record.submissionId}
				</a>
			</div>
		</div>
	);
};

const CARD_TITLE = "User feedback";

export const FeedbackCard: React.FC<FeedbackCardProps> = ({ pagePath }) => {
	const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);
	const [stats, setStats] = useState<FeedbackStats | null>(null);
	const [error, setError] = useState<AirtableApiError | null>(null);
	const [isLoading, setIsLoading] = useState<boolean>(false);
	const [isExpanded, setIsExpanded] = useState<boolean>(() => {
		return localStorage.getItem(`card_${CARD_TITLE.replace(/\s+/g, "_")}_expanded`) === "true";
	});
	const [showAll, setShowAll] = useState<boolean>(false);
	const hasFetchedRef = useRef<string | null>(null);
	const INITIAL_DISPLAY_COUNT = 5;

	// fetch feedback when expanded and pagePath changes (or first expansion)
	useEffect(() => {
		if (isExpanded && hasFetchedRef.current !== pagePath) {
			hasFetchedRef.current = pagePath;
			loadFeedback();
		}
	}, [isExpanded, pagePath]);

	const handleExpandedChange = (expanded: boolean) => {
		setIsExpanded(expanded);
	};

	const loadFeedback = async () => {
		setIsLoading(true);
		setError(null);

		try {
			// fetch feedback via proxy (uses Wagtail session cookie)
			const { records, stats: statistics } = await getFeedback(pagePath);
			setFeedback(records);
			setStats(statistics);

			// track successful feedback view
			trackEvent("feedback_viewed", {
				page_path: pagePath,
				total_feedback: statistics.total,
				helpful_percent: statistics.helpfulPercent
			});
		} catch (err) {
			setError(err as AirtableApiError);
		} finally {
			setIsLoading(false);
		}
	};

	const handleRetry = () => {
		// clear cache and refetch
		clearCache(pagePath);
		hasFetchedRef.current = null;
		loadFeedback();
	};

	const handleDownloadCSV = () => {
		// ensure all feedback is visible before downloading
		if (!showAll && feedback.length > INITIAL_DISPLAY_COUNT) {
			setShowAll(true);
		}

		// generate CSV content
		const csvContent = generateCSV(feedback);

		// create blob and download
		const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.setAttribute("href", url);
		link.setAttribute("download", `feedback-${pagePath.replace(/\//g, "-")}-${new Date().toISOString().split("T")[0]}.csv`);
		link.style.visibility = "hidden";
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);

		// track download event
		trackEvent("feedback_csv_downloaded", {
			page_path: pagePath,
			total_records: feedback.length,
		});
	};

	const generateCSV = (records: FeedbackRecord[]): string => {
		// CSV headers
		const headers = [
			"Submission ID",
			"Date",
			"Was Helpful",
			"Issue Category",
			"What Was Helpful",
			"Additional Details",
			"Referrer",
			"Airtable ID"
		];

		// escape CSV field (handle quotes and commas)
		const escapeCSVField = (field: string | null): string => {
			if (field === null || field === undefined) {
				return "";
			}
			const stringField = String(field);
			// if field contains comma, quote, or newline, wrap in quotes and escape existing quotes
			if (stringField.includes(",") || stringField.includes("\"") || stringField.includes("\n")) {
				return `"${stringField.replace(/"/g, "\"\"")}"`;
			}
			return stringField;
		};

		// format date to readable format
		const formatDate = (dateString: string): string => {
			try {
				const date = new Date(dateString);
				return date.toLocaleDateString("en-US", {
					month: "short",
					day: "numeric",
					year: "numeric",
				});
			} catch {
				return dateString;
			}
		};

		// create CSV rows
		const rows = records.map(record => [
			escapeCSVField(record.submissionId),
			escapeCSVField(formatDate(record.submissionCreated)),
			escapeCSVField(record.wasHelpful),
			escapeCSVField(record.issueCategory),
			escapeCSVField(record.whatWasHelpful),
			escapeCSVField(record.additionalDetails),
			escapeCSVField(record.referrer),
			escapeCSVField(record.id),
		].join(","));

		// combine headers and rows
		return [headers.join(","), ...rows].join("\n");
	};

	const renderContent = () => {
		// loading state
		if (isLoading) {
			return (
				<div className="flex items-center justify-center py-8">
					<div className="text-sm text-gray-500">Loading feedback...</div>
				</div>
			);
		}

		// error state
		if (error) {
			return (
				<div className="space-y-3">
					<div className="text-sm text-red-600">
						<p className="font-medium">{error.message}</p>
					</div>
					{error.type === "auth" && (
						<div className="text-sm text-gray-600">
							<p>To view user feedback, you need to be logged in to Karl.</p>
						</div>
					)}
					{error.retryable && (
						<Button onClick={handleRetry}>
							Retry
						</Button>
					)}
				</div>
			);
		}

		// no feedback available at all
		if (!stats || stats.total === 0) {
			return (
				<div className="text-sm text-gray-500 italic">
					No feedback submitted for this page yet.
				</div>
			);
		}

		// display feedback
		return (
			<div className="space-y-4">
				<div className="bg-gray-50 p-3 rounded-md mb-6 border border-gray-100">
					<div className="grid grid-cols-2 gap-4 text-center">
						<div title="Total feedback responses, including those without a comment">
							<div className="text-2xl font-bold text-gray-900">{stats.total}</div>
							<div className="text-xs text-gray-500 uppercase tracking-wide">Total Feedback</div>
						</div>
						<div title="Average helpfulness rating on sf.gov is 25%">
							<div className="text-2xl font-bold text-gray-900">{stats.helpfulPercent}%</div>
							<div className="text-xs text-gray-500 uppercase tracking-wide">Page Helpful?</div>
						</div>
					</div>
					{feedback.length > 0 && (
						<div className="mt-3 pt-3 border-t border-gray-200">
							<Button onClick={handleDownloadCSV}>
								Download CSV ({feedback.length} {feedback.length === 1 ? "item" : "items"})
							</Button>
						</div>
					)}
				</div>

				{feedback.length === 0 ? (
					<div className="text-sm text-gray-500 italic">
						No detailed feedback comments available.
					</div>
				) : (
					<>
						{(showAll ? feedback : feedback.slice(0, INITIAL_DISPLAY_COUNT)).map((record) => (
							<FeedbackItem key={record.id} record={record} />
						))}

						{!showAll && feedback.length > INITIAL_DISPLAY_COUNT && (
							<Button onClick={() => setShowAll(true)}>
								Show {feedback.length - INITIAL_DISPLAY_COUNT} more
							</Button>
						)}
					</>
				)}
			</div>
		);
	};

	return (
		<Card
			title={CARD_TITLE}
			subtitle="Comments and ratings about this page from the public"
			collapsible
			onExpandedChange={handleExpandedChange}
		>
			{renderContent()}
		</Card>
	);
};
