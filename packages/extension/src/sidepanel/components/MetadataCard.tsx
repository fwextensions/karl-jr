import React from "react";
import { Card } from "./Card";
import { OpenIcon } from "@/sidepanel/components/OpenIcon.tsx";
import type { Translation, FormSchema } from "@sf-gov/shared";

interface MetadataCardProps {
	pageId: number;
	translations?: Translation[];
	primaryAgency?: {
		title: string;
		url: string;
	} | null;
	contentType: string;
	schema?: FormSchema;
}

const CreateNewLink = ({ contentType }: { contentType: string }) => (
	<a
		href={`https://api.sf.gov/admin/pages/add/sf/${contentType}/2`}
		className="ml-4 inline-flex items-center gap-1 align-bottom"
		title="Create a new page of this type"
		target="_blank"
	>
		<OpenIcon /> Create New
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

export const MetadataCard: React.FC<MetadataCardProps> = ({
	pageId,
	translations,
	primaryAgency,
	contentType,
	schema
}) => {
	const apiUrl = `https://api.sf.gov/api/v2/pages/${pageId}/`;

	// Extract the last part after the dot (e.g., "ResourceCollection" from "sf.ResourceCollection")
	const contentTypeName = contentType.split(".").pop() || contentType;
	const contentTypeParam = contentTypeName.toLowerCase();
	const formEditUrl = schema
		? `https://formio.dev.sf.gov/#/project/${schema.project}/form/${schema._id}/edit`
		: null;

	return (
		<Card
			title="Advanced"
			collapsible
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

				<div className="text-sm text-gray-600 shrink-0">Page ID:</div>
				<div className="text-sm font-medium text-gray-900">
					<a
						href={apiUrl}
						target="_blank"
						rel="noopener noreferrer"
						title="View page data from SF.gov API"
						className="text-sm break-all"
					>
						{pageId}
					</a>
				</div>
			</div>

			{translations && translations.length > 0 && (
				<>
					<h3 className="text-sm font-semibold text-gray-700 mt-2">
						Translations
					</h3>
					<ul className="space-y-2">
						{translations?.map((translation) => (
							<li key={translation.pageId} className="flex items-center gap-3">
            <span className="inline-block px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded uppercase">
              {translation.languageCode}
            </span>
								<a
									href={translation.editUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm flex-1"
								>
									{translation.title}
								</a>
								<OpenIcon className="w-4 h-4 text-gray-400" aria-hidden="true" />
							</li>
						))}
					</ul>
				</>
			)}
		</Card>
	);
};
