import React from "react";
import { EditIcon } from "@/sidepanel/components/EditIcon.tsx";
import { trackEvent } from "@/lib/analytics";

interface EditLinkCardProps {
	pageId: number;
}

export const EditLinkCard: React.FC<EditLinkCardProps> = ({ pageId }) => {
	const editUrl = `https://api.sf.gov/admin/pages/${pageId}/edit/`;

	const handleClick = () => {
		trackEvent("edit_button_clicked", {
			page_id: pageId,
			trigger: "sidepanel_button"
		});
	};

	return (
		<a
			href={editUrl}
			target="_blank"
			rel="noopener noreferrer"
			onClick={handleClick}
			className="mb-6 inline-flex items-center gap-2 rounded-sm bg-sfgov-blue px-4 py-2 text-sm font-medium text-white shadow hover:bg-sfgov-blue-hover cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
		>
			<EditIcon className="h-4 w-4" aria-hidden="true" />
			Edit on Karl
		</a>
	);
};
