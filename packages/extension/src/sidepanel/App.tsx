import { useEffect } from "react";
import { useSfGovPage } from "./hooks/useSfGovPage";
import { LoadingState } from "./components/LoadingState";
import { ErrorState } from "./components/ErrorState";
import { PageHeader } from "./components/PageHeader";
import { MetadataCard } from "./components/MetadataCard";
import { MediaAssetsCard } from "./components/MediaAssetsCard";
import { FormConfirmationCard } from "./components/FormConfirmationCard";
import { PreviewBanner } from "./components/PreviewBanner";
import { FeedbackCard } from "./components/FeedbackCard";
import { LinksCard } from "./components/LinksCard";
import { initAnalytics, trackEvent, trackError, identifyUser } from "@/lib/analytics";

const Container = ({ children }: { children: React.ReactNode }) => (
	<div className="min-h-screen p-4 bg-gray-50">
		{children}
	</div>
);

export default function App()
{
	const {
		pageData,
		error,
		isLoading,
		isOnSfGov,
		isAdminPage,
		isPreviewMode,
		previewUrl,
		previewTimestamp,
		currentUrl,
		pagePath,
		retry
	} = useSfGovPage();

	// initialize analytics
	useEffect(() => {
		initAnalytics();
	}, []);

	// identify user when side panel loads (after we've checked authentication)
	useEffect(() => {
		if (!isLoading && isOnSfGov) {
			// call identifyUser to check if user is logged in and create person profile
			// this runs after page data loads, so we know authentication state
			identifyUser();
		}
	}, [isLoading, isOnSfGov]);

	// track side panel views - only once per URL when we have final data
	useEffect(() => {
		// wait until loading is complete and we have a definitive state
		// (either pageData is available, or we're on a non-SF.gov page, or we're on admin)
		if (isLoading || !currentUrl) return;

		// only track for SF.gov pages
		if (!isOnSfGov) return;

		// for admin pages, track immediately (no pageData needed for iframe view)
		// for public pages, wait until pageData is loaded
		if (!isAdminPage && !pageData) return;

		trackEvent("sidepanel_viewed", {
			is_admin_page: isAdminPage,
			content_type: pageData?.contentType,
			has_data: !!pageData,
			page_url: currentUrl
		});
	}, [isOnSfGov, isLoading, isAdminPage, pageData, currentUrl]);

	// track errors
	useEffect(() => {
		if (error) {
			trackError("sidepanel_load_error", new Error(error.message), {
				error_type: error.type,
				page_url: currentUrl
			});
		}
	}, [error, currentUrl]);

	if (isLoading) {
		return (
			<Container>
				<LoadingState />
			</Container>
		);
	}

	if (error) {
		return (
			<Container>
				<ErrorState error={error} onRetry={retry} />
			</Container>
		);
	}

	if (!isOnSfGov) {
		return (
			<Container>
				<div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center">
					<p className="text-gray-600 text-sm">
						Navigate to an SF.gov page to view CMS information
					</p>
				</div>
			</Container>
		);
	}

	// If on admin page, show only the iframe with the SF.gov page
	if (isAdminPage) {
		const iframeUrl = (isPreviewMode && previewUrl) || previewUrl || pageData?.meta.htmlUrl;

		if (iframeUrl) {
			return (
				<iframe
					key={iframeUrl}
					src={iframeUrl}
					className="w-full h-screen border-0"
					title="SF.gov Page Preview"
				/>
			);
		}

		return (
			<Container>
				<div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center">
					<p className="text-gray-600 text-sm">Preview is not available yet.</p>
				</div>
			</Container>
		);
	}

	if (!pageData) {
		return (
			<Container>
				<div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center">
					<p className="text-gray-600 text-sm">Page data is unavailable.</p>
				</div>
			</Container>
		);
	}

	return (
		<Container>
			<div className="max-w-3xl mx-auto space-y-4 [&>*:last-child]:mb-0">
				{isPreviewMode && previewTimestamp > 0 && (
					<PreviewBanner timestamp={previewTimestamp} />
				)}

				{isAdminPage && !isPreviewMode && (
					<div className="bg-gray-50 border border-gray-200 rounded-lg shadow-sm p-4 mb-4">
						<div className="flex items-center gap-2">
							<svg
								className="w-5 h-5 text-gray-500 shrink-0"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								xmlns="http://www.w3.org/2000/svg"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
								/>
							</svg>
							<div className="flex-1">
								<p className="text-sm font-medium text-gray-700">
									Preview unavailable
								</p>
								<p className="text-xs text-gray-600 mt-0.5">
									The preview button is currently disabled
								</p>
							</div>
						</div>
					</div>
				)}

				<PageHeader pageData={pageData} />
				<FeedbackCard pagePath={pagePath} />
				<MediaAssetsCard images={pageData.images} files={pageData.files} />
				<LinksCard files={pageData.files} pageUrl={currentUrl} />
				{pageData.formConfirmation && (
					<FormConfirmationCard formConfirmation={pageData.formConfirmation} currentUrl={currentUrl} />
				)}
				<MetadataCard
					pageId={pageData.id}
					translations={pageData.translations}
					primaryAgency={pageData.primaryAgency}
					contentType={pageData.contentType}
					schema={pageData.schema}
				/>
			</div>
		</Container>
	);
}
