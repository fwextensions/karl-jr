import React from "react";
import { Card } from "./Card";
import { OpenIcon } from "../icons/OpenIcon.tsx";
import type { FormConfirmation } from "@sf-gov/shared";

interface FormConfirmationCardProps {
	formConfirmation: FormConfirmation;
	currentUrl: string;
}

export const FormConfirmationCard: React.FC<FormConfirmationCardProps> = ({
	formConfirmation,
	currentUrl
}) => {
	const getSubmittedUrl = () => {
		try {
			const url = new URL(currentUrl);
			url.searchParams.set("submitted", "true");
			return url.toString();
		} catch {
			return currentUrl + "?submitted=true";
		}
	};

	const handleOpenConfirmation = () => {
		window.open(getSubmittedUrl(), "_blank");
	};

	return (
		<Card title="Form Confirmation" subtitle="Text shown on the confirmation page">
			<div className="space-y-3">
				{formConfirmation.title && (
					<div className="mt-2 font-semibold text-gray-700 text-[1.25em]">
						{formConfirmation.title}
					</div>
				)}
				{formConfirmation.body && (
					<div
						className="text-sm text-gray-700 max-w-none form-confirmation"
						dangerouslySetInnerHTML={{ __html: formConfirmation.body }}
					/>
				)}
			</div>
			<button
				onClick={handleOpenConfirmation}
				className="mt-2 inline-flex items-center gap-1 text-sm text-sfgov-blue hover:underline"
				title="Open confirmation page in new tab"
			>
				<OpenIcon className="w-4 h-4" aria-hidden="true" />
				Open confirmation page
			</button>
		</Card>
	);
};
