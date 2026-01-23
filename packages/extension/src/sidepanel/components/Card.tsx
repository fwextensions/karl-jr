import React, { useState } from "react";

const getStorageKey = (title: string) => `card_${title.replace(/\s+/g, "_")}_expanded`;

const clickableHeaderStyle ="relative box-content w-full flex items-center justify-between text-sm font-semibold text-gray-900 -my-1 px-[6px] py-1 left-[-6px] rounded-sm hover:text-gray-900 hover:bg-gray-100 cursor-pointer transition-colors";

interface CardProps {
	title?: string;
	subtitle?: string;
	children: React.ReactNode;
	className?: string;
	collapsible?: boolean;
	onExpandedChange?: (expanded: boolean) => void;
}

export const Card: React.FC<CardProps> = ({
	title,
	subtitle,
	children,
	className = "",
	collapsible = true,
	onExpandedChange,
}) => {
	const [isExpanded, setIsExpanded] = useState<boolean>(() => {
		if (!collapsible || !title) return true;
		return localStorage.getItem(getStorageKey(title)) === "true";
	});

	const toggleExpanded = () => {
		if (!collapsible || !title) return;
		const newExpanded = !isExpanded;
		setIsExpanded(newExpanded);
		localStorage.setItem(getStorageKey(title), String(newExpanded));
		onExpandedChange?.(newExpanded);
	};

	const showContent = !collapsible || isExpanded;

	return (
		<div className={`bg-white border border-gray-200 rounded-lg shadow-sm p-4 ${className} ${collapsible && isExpanded ? "mb-4" : ""}`}>
			{title && (
				<button
					onClick={toggleExpanded}
					disabled={!collapsible}
					className={`flex items-center justify-between w-full text-left ${collapsible ? clickableHeaderStyle : ""}`}
				>
					<div>
						<h2 className="text-lg font-semibold text-gray-900">{title}</h2>
					</div>
					{collapsible &&
						<svg
							className={`w-5 h-5 text-gray-500 hover:text-gray-700 transition-all duration-200 ${isExpanded ? "rotate-180" : ""}`}
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
						</svg>
					}
				</button>
			)}
			{showContent && subtitle && (
				<h3 className="text-sm text-gray-500 pt-1 pb-2">{subtitle}</h3>
			)}
			{showContent && (
				<div className={`flex flex-col gap-2 mt-3`}>{children}</div>
			)}
		</div>
	);
};
