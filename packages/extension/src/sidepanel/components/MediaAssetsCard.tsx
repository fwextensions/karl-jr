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

interface DocumentItem {
	key: string;
	url: string;
	label: string;
	sublabel: string | null;
	editHref: string;
	onEditClick?: React.MouseEventHandler<HTMLAnchorElement>;
	onOpenClick?: React.MouseEventHandler<HTMLAnchorElement>;
	editTitle: string;
	openTitle: string;
	showEditIcon: boolean;
}

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

	const renderDocumentList = () => {
		const fileItems: DocumentItem[] = files.map((file) => {
			const filename = getFilenameFromUrl(file.url);
			const label = file.title || file.filename || "Untitled File";
			const sublabel = (file.filename && file.title && file.title !== file.filename)
				? file.filename
				: null;
			return {
				key: `file-${file.id}`,
				url: file.url,
				label,
				sublabel,
				editHref: "#",
				onEditClick: () => handleFileClick(file.id),
				editTitle: filename ? `Edit document: ${filename}` : `Edit document: ${label}`,
				openTitle: filename ? `Open document: ${filename}` : `Open document: ${label}`,
				showEditIcon: true,
			};
		});

		const linkItems: DocumentItem[] = documentLinks.map((docLink) => {
			const filename = getFilenameFromUrl(docLink.url);
			const label = docLink.text || "Untitled Document";
			return {
				key: docLink.url,
				url: docLink.url,
				label,
				sublabel: filename || null,
				editHref: docLink.url,
				onOpenClick: () => handleDocumentLinkClick(docLink.url),
				editTitle: filename ? `Open document: ${filename}` : `Open document: ${label}`,
				openTitle: filename ? `Open document: ${filename}` : `Open document: ${label}`,
				showEditIcon: false,
			};
		});

		return (
			<ul className="w-full space-y-2">
				{[...fileItems, ...linkItems].map((doc) => (
					<li key={doc.key} className="flex items-center gap-2">
						<a
							href={doc.editHref}
							target={doc.editHref === "#" ? undefined : "_blank"}
							rel={doc.editHref === "#" ? undefined : "noopener noreferrer"}
							onClick={doc.onEditClick ?? doc.onOpenClick}
							className="text-sm text-left min-w-0 shrink inline-flex flex-row items-center gap-2 cursor-pointer bg-transparent border-none p-0"
							title={doc.editTitle}
						>
							{doc.showEditIcon && <EditIcon className="h-4 w-4 shrink-0" aria-hidden="true" />}
							<span className="flex flex-col items-start break-all">
								<span>{doc.label}</span>
								{doc.sublabel && (
									<span className="text-xs text-gray-500 break-all">{doc.sublabel}</span>
								)}
							</span>
						</a>
						<a
							href={doc.url}
							target="_blank"
							rel="noopener noreferrer"
							onClick={doc.onOpenClick}
							className="ml-1 inline-block bg-sfgov-blue rounded-sm text-white opacity-70 hover:opacity-100 shrink-0 mt-0.5"
							title={doc.openTitle}
						>
							<OpenIcon className="w-4 h-4" aria-hidden="true" />
						</a>
					</li>
				))}
			</ul>
		);
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
									<li key={image.id} className="flex items-start gap-2">
										<a
											href="#"
											onClick={() => handleImageClick(image.id)}
											className="text-sm text-left min-w-0 shrink cursor-pointer bg-transparent border-none p-0"
											title={filename ? `Edit image: ${filename}` : `Edit image: ${image.title || "Untitled Image"}`}
										>
											<EditIcon className="h-4 w-4 shrink-0 inline align-text-bottom mr-1" aria-hidden="true" />
											{image.title || image.filename || "Untitled Image"}
											{image.width && image.height && (
												<span className={`text-xs whitespace-nowrap ml-1 inline-block no-underline decoration-0 ${image.width > 2500 || image.height > 2500 ? "text-red-500 font-bold" : "text-gray-400"}`}>{image.width}×{image.height}</span>
											)}
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
					{hasFiles || documentLinks.length > 0
						? renderDocumentList()
						: <p className="text-sm text-gray-500 italic">No documents</p>}
				</div>
			</div>
		</Card>
	);
};
