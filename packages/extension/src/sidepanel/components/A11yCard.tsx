import { Card } from "./Card";
import { A11yChecker } from "./A11yChecker";
import type { MediaAsset } from "@sf-gov/shared";

interface A11yCardProps {
	pageUrl: string;
	images: MediaAsset[];
	onMissingAltTextUrls?: (urls: Set<string>) => void;
}

export function A11yCard({ pageUrl, images, onMissingAltTextUrls }: A11yCardProps) {
	return (
		<Card title="Accessibility" collapsible>
			<A11yChecker pageUrl={pageUrl} images={images} onMissingAltTextUrls={onMissingAltTextUrls} />
		</Card>
	);
}
