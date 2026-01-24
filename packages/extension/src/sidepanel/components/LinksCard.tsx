import React, { useEffect, useState } from "react";
import { Card } from "./Card";
import { OpenIcon } from "@/sidepanel/components/OpenIcon.tsx";
import {
	extractCategorizedLinks,
	type CategorizedLinks,
	type LinkInfo
} from "@/lib/link-check";
import type { MediaAsset } from "@sf-gov/shared";
import { LinkChecker } from "@/sidepanel/components/LinkChecker.tsx";

function extractDisplayURL(
	url: string,
	linkType: "filename" | "hostname" | "pathname")
{
	if (linkType === "filename") {
		return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
	} else if (linkType === "hostname") {
		return new URL(url).hostname;
	} else {
		return new URL(url).pathname;
	}
}

interface LinksListProps {
	title: string;
	links: LinkInfo[];
	linkType: "filename" | "hostname" | "pathname";
	defaultText: string;
}

function LinksList({
	title,
	links,
	linkType,
	defaultText
}: LinksListProps)
{
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<div className="relative">
			<button
				onClick={() => setIsExpanded(!isExpanded)}
				className="relative box-content w-full flex items-center justify-between text-sm font-semibold text-gray-700 px-[6px] py-1 left-[-6px] rounded-sm hover:text-gray-900 hover:bg-gray-100 cursor-pointer transition-colors"
			>
				<span>
					{title} ({links.length})
				</span>
				<svg
					className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
				</svg>
			</button>
			{isExpanded && (
				<ul className="space-y-2">
					{links.map((
						link,
						index) => (
						<li key={index}>
							<a
								href={link.url}
								title={link.url}
								target="_blank"
								rel="noopener noreferrer"
								className="text-sm inline-flex items-center gap-2"
							>
								<span className="flex flex-col items-start">
									<span>{link.text || defaultText}</span>
									<span className="text-xs text-gray-500 break-all">
										{extractDisplayURL(link.url, linkType)}
									</span>
								</span>
								<OpenIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
							</a>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

interface LinksCardProps {
	files: MediaAsset[],
	pageUrl: string
}

export const LinksCard: React.FC<LinksCardProps> = ({ files, pageUrl }) => {
	const [links, setLinks] = useState<CategorizedLinks>({
		pdfs: [],
		otherFiles: [],
		external: [],
		internal: [],
	});
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		const fetchLinks = async () => {
			try {
				const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

				if (tabs[0]?.id) {
					const results = await chrome.scripting.executeScript({
						target: { tabId: tabs[0].id },
						func: extractCategorizedLinks,
					});
					if (results[0]?.result) {
						const allLinks = results[0].result;

						// filter out PDFs that are already in the files metadata
						const fileUrls = new Set(files.map(f => f.url));
						const filteredPdfs = allLinks.pdfs.filter(
							pdf => !fileUrls.has(pdf.url));

						setLinks({
							...allLinks,
							pdfs: filteredPdfs,
						});
					}
				}
			} catch (error) {
				console.error("Failed to extract links:", error);
			} finally {
				setIsLoading(false);
			}
		};

		fetchLinks();
	}, [files]);

	const { pdfs, otherFiles, external, internal } = links;
	const hasAnyLinks = pdfs.length > 0 ||
		otherFiles.length > 0 ||
		external.length > 0 ||
		internal.length > 0;

	if (isLoading) {
		return (
			<Card title="Links" collapsible>
				<p className="text-sm text-gray-500 italic">Loading...</p>
			</Card>
		);
	}

	if (!hasAnyLinks) {
		return (
			<Card title="Links" collapsible>
				<p className="text-sm text-gray-500 italic">No links found</p>
			</Card>
		);
	}

	return (
		<Card title="Links" collapsible>
			<div className="space-y-2 mb-2">
				{pdfs.length > 0 &&
					<LinksList
						title="PDFs"
						links={pdfs}
						linkType="filename"
						defaultText="Untitled PDF"
					/>
				}

				{otherFiles.length > 0 &&
					<LinksList
						title="Other Files"
						links={otherFiles}
						linkType="filename"
						defaultText="Untitled File"
					/>
				}

{/*
				{external.length > 0 &&
					<LinksList
						title="Links to Other Sites"
						links={external}
						linkType="hostname"
						defaultText="Untitled Link"
					/>
				}

				{internal.length > 0 &&
					<LinksList
						title="Links to sf.gov"
						links={internal}
						linkType="pathname"
						defaultText="Untitled Link"
					/>
				}
*/}
			</div>
			{hasAnyLinks ? (
				<LinkChecker pageUrl={pageUrl} />
			) : (
				<p className="text-sm text-gray-500 italic mt-3">No links on this page</p>
			)}
		</Card>
	);
};
