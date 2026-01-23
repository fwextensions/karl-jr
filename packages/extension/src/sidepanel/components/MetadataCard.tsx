import React from "react";
import { Card } from "./Card";
import type { Translation } from "@sf-gov/shared";
import { OpenIcon } from "@/sidepanel/components/OpenIcon.tsx";

interface MetadataCardProps {
	pageId: number;
	translations?: Translation[];
}

export const MetadataCard: React.FC<MetadataCardProps> = ({
	pageId,
	translations
}) => {
	const apiUrl = `https://api.sf.gov/api/v2/pages/${pageId}/`;

	return (
		<Card
			title="Advanced"
			collapsible
		>
			<div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3">
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
