import React from "react";

interface OpenIconProps {
	className?: string;
}

export const OpenIcon: React.FC<OpenIconProps> = ({ className = "w-4 h-4" }) => (
	<svg
		className={className}
		fill="none"
		stroke="currentColor"
		viewBox="0 0 24 24"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={2}
			d="M10.1429 7H7C5.89543 7 5 7.89543 5 9V17C5 18.1046 5.89543 19 7 19H15C16.1046 19 17 18.1046 17 17V13.2143M19 5H15M19 5V9M19 5L9 15"
		/>
	</svg>
);
