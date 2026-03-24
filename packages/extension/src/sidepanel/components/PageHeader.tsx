import React from "react";
import type { WagtailPage } from "@sf-gov/shared";
import { Card } from "@/sidepanel/components/Card.tsx";
import { EditIcon } from "@/sidepanel/components/EditIcon.tsx";
import { trackEvent } from "@/lib/analytics.ts";
import { Button } from "@/sidepanel/components/Button.tsx";

interface PageHeaderProps {
	pageData: WagtailPage;
	currentUrl: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ pageData, currentUrl }) => {
	const { title, id } = pageData;

	const editUrl = `https://api.sf.gov/admin/pages/${id}/edit/`;

	const handleClick = async () => {
		trackEvent("edit_button_clicked", {
			page_id: id,
			page_url: currentUrl,
			trigger: "sidepanel_button",
		});

		await chrome.tabs.create({ url: editUrl });
	};

	return (
		<Card
			title={title}
			className="[&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-4"
			collapsible={false}
		>
			<Button
				onClick={handleClick}
				className="self-start"
			>
				<EditIcon className="h-4 w-4" aria-hidden="true" />
				Edit on Karl
			</Button>
		</Card>
	);
};
