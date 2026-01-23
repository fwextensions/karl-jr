import React from "react";
import type { WagtailPage } from "@sf-gov/shared";
import { Card } from "@/sidepanel/components/Card.tsx";
import { EditIcon } from "@/sidepanel/components/EditIcon.tsx";
import { trackEvent } from "@/lib/analytics.ts";
import { Button } from "@/sidepanel/components/Button.tsx";

const CreateNewLink = ({ contentType }: { contentType: string }) => (
	<a
		href={`https://api.sf.gov/admin/pages/add/sf/${contentType}/2`}
		className="ml-4 inline-flex items-center gap-1 align-bottom"
		title="Create a new page of this type"
		target="_blank"
	>
		<EditIcon /> Create New
	</a>
);

function formatContentType(contentType: string): string
{
	// Add spaces before capital letters and capitalize first letter
	return contentType
		.replace(/([A-Z])/g, " $1")
		.trim()
		.replace(/^./, (str) => str.toUpperCase());
}

interface PageHeaderProps {
	pageData: WagtailPage;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ pageData }) => {
	const { title, contentType, primaryAgency, schema, id } = pageData;

	// Extract the last part after the dot (e.g., "ResourceCollection" from "sf.ResourceCollection")
	const contentTypeName = contentType.split(".").pop() || contentType;
	const contentTypeParam = contentTypeName.toLowerCase();
	const editUrl = `https://api.sf.gov/admin/pages/${id}/edit/`;
	const formEditUrl = schema
		? `https://formio.dev.sf.gov/#/project/${schema.project}/form/${schema._id}/edit`
		: null;

	const handleClick = () => {
		trackEvent("edit_button_clicked", {
			page_id: id,
			trigger: "sidepanel_button"
		});
		window.open(editUrl, "_blank");
	};

	return (
		<Card
			title={title}
			className="[&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-4"
		>
			<div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3">
				<div className="text-sm text-gray-600">Primary Agency:</div>
				<div className="text-sm font-medium text-gray-900">
					{primaryAgency ? (
						<a
							href={primaryAgency.url}
							target="_blank"
							rel="noopener noreferrer"
						>
							{primaryAgency.title}
						</a>
					) : (
						<span className="text-gray-400 italic">None</span>
					)}
				</div>

				<div className="text-sm text-gray-600">Content Type:</div>
				<div className="text-sm font-medium text-gray-900">
					{formatContentType(contentTypeName)}
					<CreateNewLink contentType={contentTypeParam} />
				</div>

				{schema && formEditUrl && (
					<>
						<div className="text-sm text-gray-600">Form Name:</div>
						<div className="text-sm font-medium text-gray-900">
							<a
								href={formEditUrl}
								target="_blank"
								rel="noopener noreferrer"
								title="View form in form.io"
							>
								{schema.title}
							</a>
						</div>
					</>
				)}
			</div>

			<Button
				onClick={handleClick}
				className="self-start mt-4"
			>
				<EditIcon className="h-4 w-4" aria-hidden="true" />
				Edit on Karl
			</Button>
		</Card>
	);
};
