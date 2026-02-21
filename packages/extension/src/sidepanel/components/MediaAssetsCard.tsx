import React from "react";
import { Card } from "./Card";
import type { MediaAsset } from "@sf-gov/shared";
import { EditIcon } from "@/sidepanel/components/EditIcon.tsx";
import { OpenIcon } from "@/sidepanel/components/OpenIcon.tsx";
import { trackEvent } from "@/lib/analytics";
import type { CategorizedLinks, LinkInfo } from "@/lib/link-check";

// helper function to extract filename from URL
const getFilenameFromUrl = (url: string): string => {
	try {
		const urlPath = new URL(url).pathname;
		const filename = urlPath.split("/").pop();
		return filename || "";
	} catch {
		return "";
	}
};

interface MediaAssetsCardProps {
	images: MediaAsset[];
	files: MediaAsset[];
	categorizedLinks: CategorizedLinks | null;
	isLoadingLinks: boolean;
	missingAltTextUrls?: Set<string>;
}

export const MediaAssetsCard: React.FC<MediaAssetsCardProps> = ({
	images,
	files,
	categorizedLinks,
	isLoadingLinks,
	missingAltTextUrls,
}) => {
	const hasImages = images.length > 0;
	const hasFiles = files.length > 0;

	// derive document links from categorized links, filtering out duplicates with file metadata
	const documentLinks: LinkInfo[] = (() => {
		if (!categorizedLinks) return [];

		const fileUrls = new Set(files.map(f => f.url));
		const filteredPdfs = categorizedLinks.pdfs.filter(
			pdf => !fileUrls.has(pdf.url));
		const filteredOtherFiles = categorizedLinks.otherFiles.filter(
			file => !fileUrls.has(file.url));

		return [...filteredPdfs, ...filteredOtherFiles];
	})();

	const handleImageClick = async (imageId: number) => {
		// track image click
		trackEvent("media_asset_clicked", {
			type: "image",
			asset_id: imageId
		});

		const adminUrl = `https://api.sf.gov/admin/images/${imageId}/`;
		const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tabs[0]?.id) {
			// navigate from within the page context to preserve history properly
			await chrome.scripting.executeScript({
				target: { tabId: tabs[0].id },
				func: (url: string) => {
					window.location.href = url;
				},
				args: [adminUrl],
			});
		}
	};

	const handleFileClick = async (fileId: number) => {
		// track file/document click
		trackEvent("media_asset_clicked", {
			type: "document",
			asset_id: fileId
		});

		const adminUrl = `https://api.sf.gov/admin/documents/edit/${fileId}/`;
		const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tabs[0]?.id) {
			// navigate from within the page context to preserve history properly
			await chrome.scripting.executeScript({
				target: { tabId: tabs[0].id },
				func: (url: string) => {
					window.location.href = url;
				},
				args: [adminUrl],
			});
		}
	};

	const handleDocumentLinkClick = (url: string) => {
		// track document link click
		trackEvent("document_link_clicked", {
			url: url
		});
	};

	if (!hasImages && !hasFiles && documentLinks.length === 0) {
		if (isLoadingLinks) {
			return (
				<Card title="Images and documents" collapsible>
					<p className="text-sm text-gray-500 italic">Loading...</p>
				</Card>
			);
		}
		return (
			<Card title="Images and documents" collapsible>
				<p className="text-sm text-gray-500 italic">No media assets on this page</p>
			</Card>
		);
	}

	return (
		<Card title="Images and documents" collapsible>
			<div className="space-y-4">
				{/* Images Section */}
				<div>
					<h3 className="text-sm font-semibold text-gray-700 mb-2">Images ({images.length})</h3>
					{hasImages ? (
						<ul className="w-full space-y-2">
							{images.map((image) => {
								const filename = getFilenameFromUrl(image.url);
								const missingAltText = missingAltTextUrls?.has(image.url) ?? false;
								return (
									<li key={image.id} className="flex items-center gap-2">
										<a
											href="#"
											onClick={() => handleImageClick(image.id)}
											className="text-sm text-left min-w-0 shrink inline-flex flex-row items-center gap-2 cursor-pointer bg-transparent border-none p-0"
											title={filename ? `Edit image: ${filename}` : `Edit image: ${image.title || "Untitled Image"}`}
										>
											<EditIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
											{image.title || image.filename || "Untitled Image"}
										</a>
										{missingAltText && (
											<span className="text-amber-600 shrink-0" title="Missing alt text">⚠️</span>
										)}
										<a
											href={image.url}
											target="_blank"
											rel="noopener noreferrer"
											className="ml-1 inline-block bg-sfgov-blue rounded-sm text-white opacity-70 hover:opacity-100 shrink-0 mt-0.5"
											title={filename ? `Open image: ${filename}` : `Open image: ${image.title || "Untitled Image"}`}
										>
											<OpenIcon className="w-4 h-4" aria-hidden="true" />
										</a>
									</li>
								);
							})}
						</ul>
					) : (
						<p className="text-sm text-gray-500 italic">No images</p>
					)}
				</div>

				{/* Documents Section - includes both files and document links */}
				<div>
					<h3 className="text-sm font-semibold text-gray-700 mb-2">
						Documents ({isLoadingLinks ? `${files.length}+` : files.length + documentLinks.length})
					</h3>
					{hasFiles || documentLinks.length > 0 ? (
						<ul className="w-full space-y-2">
							{/* Documents from files metadata first */}
							{files.map((file) => {
								const filename = getFilenameFromUrl(file.url);
								return (
									<li key={`file-${file.id}`} className="flex items-center gap-2">
										<a
											href="#"
											onClick={() => handleFileClick(file.id)}
											className="text-sm text-left min-w-0 shrink inline-flex flex-row items-center gap-2 cursor-pointer bg-transparent border-none p-0"
											title={filename ? `Edit document: ${filename}` : `Edit document: ${file.title || "Untitled File"}`}
										>
											<EditIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
											<span className="flex flex-col items-start">
												<span>{file.title || file.filename || "Untitled File"}</span>
												{file.filename && file.title
													&& file.title !== file.filename
													&& (<span className="text-xs text-gray-500">{file.filename}</span>)}
											</span>
										</a>
										<a
											href={file.url}
											target="_blank"
											rel="noopener noreferrer"
											className="ml-1 inline-block bg-sfgov-blue rounded-sm text-white opacity-70 hover:opacity-100 shrink-0 mt-0.5"
											title={filename ? `Open document: ${filename}` : `Open document: ${file.title || "Untitled File"}`}
										>
											<OpenIcon className="w-4 h-4" aria-hidden="true" />
										</a>
									</li>
								);
							})}

							{/* Document links from page content second */}
							{documentLinks.map((docLink) => {
								const filename = getFilenameFromUrl(docLink.url);
								return (
									<li key={docLink.url} className="flex items-center gap-2">
										<a
											href={docLink.url}
											target="_blank"
											rel="noopener noreferrer"
											onClick={() => handleDocumentLinkClick(docLink.url)}
											className="text-sm text-left min-w-0 shrink inline-flex flex-row items-center gap-2 cursor-pointer bg-transparent border-none p-0"
											title={filename ? `Open document: ${filename}` : `Open document: ${docLink.text || "Untitled Document"}`}
										>
											<span className="flex flex-col items-start">
												<span>{docLink.text || "Untitled Document"}</span>
												{filename && (<span className="text-xs text-gray-500">{filename}</span>)}
											</span>
										</a>
										<a
											href={docLink.url}
											target="_blank"
											rel="noopener noreferrer"
											className="ml-1 inline-block bg-sfgov-blue rounded-sm text-white opacity-70 hover:opacity-100 shrink-0 mt-0.5"
											title={filename ? `Open document: ${filename}` : `Open document: ${docLink.text || "Untitled Document"}`}
										>
											<OpenIcon className="w-4 h-4" aria-hidden="true" />
										</a>
									</li>
								);
							})}
						</ul>
					) : (
						<p className="text-sm text-gray-500 italic">No documents</p>
					)}
				</div>
			</div>
		</Card>
	);
};
