import { Card } from "./Card";
import { A11yChecker } from "./A11yChecker";
import type { MediaAsset } from "@sf-gov/shared";

interface A11yCardProps {
	pageUrl: string;
	images: MediaAsset[];
}

export function A11yCard({ pageUrl, images }: A11yCardProps) {
	return (
		<Card title="Accessibility" collapsible>
			<A11yChecker pageUrl={pageUrl} images={images} />
		</Card>
	);
}
