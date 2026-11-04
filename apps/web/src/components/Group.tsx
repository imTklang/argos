import { useId } from "react";

/** An inset grouped section, as in iOS Settings: header, rounded cells, footer. */
export function Group({
	title,
	footer,
	children,
}: {
	title?: string;
	footer?: React.ReactNode;
	children: React.ReactNode;
}) {
	const id = useId();
	return (
		<section aria-labelledby={title ? id : undefined}>
			{title && (
				<h3
					id={id}
					className="px-4 pb-1.5 text-[13px] font-semibold text-muted"
				>
					{title}
				</h3>
			)}
			<div className="card overflow-hidden rounded-2xl">{children}</div>
			{footer && <p className="px-4 pt-1.5 text-xs text-muted">{footer}</p>}
		</section>
	);
}

export function Cell({
	children,
	className = "",
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`border-b border-separator px-4 py-3 last:border-b-0 ${className}`}
		>
			{children}
		</div>
	);
}
