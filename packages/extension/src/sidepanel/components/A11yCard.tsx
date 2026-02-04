import { Card } from "./Card";
import { A11yChecker } from "./A11yChecker";

interface A11yCardProps {
	pageUrl: string;
}

export function A11yCard({ pageUrl }: A11yCardProps) {
	return (
		<Card title="Accessibility" collapsible>
			<A11yChecker pageUrl={pageUrl} />
		</Card>
	);
}
