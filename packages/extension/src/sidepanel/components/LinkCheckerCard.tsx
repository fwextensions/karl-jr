import { Card } from "./Card";
import { LinkChecker } from "./LinkChecker";

interface LinkCheckerCardProps {
	pageUrl: string;
}

export function LinkCheckerCard({ pageUrl }: LinkCheckerCardProps) {
	return (
		<Card title="Broken Link Finder">
			<LinkChecker pageUrl={pageUrl} />
		</Card>
	);
}
