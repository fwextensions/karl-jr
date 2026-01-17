import React, { useEffect, useState } from "react";
import { Card } from "./Card";
import type { MediaAsset } from "@sf-gov/shared";
import { EditIcon } from "@/sidepanel/components/EditIcon.tsx";
import { OpenIcon } from "@/sidepanel/components/OpenIcon.tsx";
import { extractPdfLinks, type LinkInfo } from "@/lib/link-check";
import { trackEvent } from "@/lib/analytics";

interface MediaAssetsCardProps {
	images: MediaAsset[];
	files: MediaAsset[];
}

export const MediaAssetsCard: React.FC<MediaAssetsCardProps> = ({
	images,
	files
}) => {
	const hasImages = images.length > 0;
	const hasFiles = files.length > 0;
	const [pdfLinks, setPdfLinks] = useState<LinkInfo[]>([]);
	const [isLoadingPdfs, setIsLoadingPdfs] = useState(true);

	useEffect(() => {
		const fetchPdfLinks = async () => {
			try {
				const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
				if (tabs[0]?.id) {
					const results = await chrome.scripting.executeScript({
						target: { tabId: tabs[0].id },
						func: extractPdfLinks,
					});
					if (results[0]?.result) {
						const allPdfLinks = results[0].result;
						const fileUrls = new Set(files.map(f => f.url));
						const dedupedPdfLinks = allPdfLinks.filter(pdf => !fileUrls.has(pdf.url));
						
						setPdfLinks(dedupedPdfLinks);
					}
				}
			} catch (error) {
				console.error("Failed to extract PDF links:", error);
			} finally {
				setIsLoadingPdfs(false);
			}
		};

		fetchPdfLinks();
	}, [files]);

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

	const handleFileClick = (fileId: number) => {
		// track file/document click
		trackEvent("media_asset_clicked", {
			type: "document",
			asset_id: fileId
		});
	};

	if (!hasImages && !hasFiles && pdfLinks.length === 0 && !isLoadingPdfs) {
		return (
			<Card title="Images and Files">
				<p className="text-sm text-gray-500 italic">No media assets
					available</p>
			</Card>
		);
	}

	return (
		<Card title="Images and Files">
			<div className="space-y-4">
				{/* Images Section */}
				<div>
					<h3 className="text-sm font-semibold text-gray-700 mb-2">Images</h3>
					{hasImages ? (
						<ul className="w-full space-y-2">
							{images.map((image) => (
								<li key={image.id} className="flex items-center gap-2">
									<a
										href="#"
										onClick={() => handleImageClick(image.id)}
										className="text-sm text-left min-w-0 shrink inline-flex flex-row items-center gap-2 cursor-pointer bg-transparent border-none p-0"
										title="Edit image on Karl"
									>
										<EditIcon className="h-4 w-4" aria-hidden="true" />
										{image.title || image.filename || "Untitled Image"}
									</a>
									<a
										href={image.url}
										target="_blank"
										rel="noopener noreferrer"
										className="ml-1 inline-block bg-sfgov-blue rounded-sm text-white opacity-70 hover:opacity-100 shrink-0 mt-0.5"
										title="Open original image in new tab"
									>
										<OpenIcon className="w-4 h-4" aria-hidden="true" />
									</a>
								</li>
							))}
						</ul>
					) : (
						<p className="text-sm text-gray-500 italic">No images</p>
					)}
				</div>

				{/* Files Section */}
				<div>
					<h3 className="text-sm font-semibold text-gray-700 mb-2">Files</h3>
					{hasFiles ? (
						<ul className="space-y-2">
							{files.map((file) => (
								<li key={file.id}>
									<a
										href={file.url}
										target="_blank"
										rel="noopener noreferrer"
										onClick={() => handleFileClick(file.id)}
										className="text-sm inline-flex items-center gap-2"
									>
                    <span className="flex flex-col items-start">
                      <span>{file.title || file.filename || "Untitled File"}</span>
											{file.filename && file.title
                        && file.title !== file.filename
                        && (<span className="text-xs text-gray-500">{file.filename}</span>)}
                    </span>
										<OpenIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
									</a>
								</li>
							))}
						</ul>
					) : (
						<p className="text-sm text-gray-500 italic">No files</p>
					)}
				</div>

				{/* PDF Links Section */}
				<div>
					<h3 className="text-sm font-semibold text-gray-700 mb-2">PDF Links</h3>
					{isLoadingPdfs ? (
						<p className="text-sm text-gray-500 italic">Loading...</p>
					) : pdfLinks.length > 0 ? (
						<ul className="space-y-2">
							{pdfLinks.map((pdf, index) => (
								<li key={index}>
									<a
										href={pdf.url}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm inline-flex items-center gap-2"
									>
										<span className="flex flex-col items-start">
											<span>{pdf.text || "Untitled PDF"}</span>
											<span className="text-xs text-gray-500 break-all">{decodeURIComponent(new URL(pdf.url).pathname.split("/").pop() || "")}</span>
										</span>
									</a>
								</li>
							))}
						</ul>
					) : (
						<p className="text-sm text-gray-500 italic">No PDF links found</p>
					)}
				</div>
			</div>
		</Card>
	);
};
