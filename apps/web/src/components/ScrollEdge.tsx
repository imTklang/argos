import { useEffect, useRef, useState } from "react";

/**
 * A bar that sticks to the top of its scroll area. The scroll edge effect
 * (content fading and softening beneath it) shows only once content is
 * actually passing underneath, as on iOS.
 */
export function ScrollEdge({
	as: Tag = "div",
	className = "",
	children,
	...rest
}: React.HTMLAttributes<HTMLElement> & { as?: "div" | "header" }) {
	const sentinel = useRef<HTMLDivElement>(null);
	const [stuck, setStuck] = useState(false);

	useEffect(() => {
		const node = sentinel.current;
		// Absent in old browsers and in jsdom: the bar just never shows the edge.
		if (!node || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(([entry]) =>
			setStuck(entry ? !entry.isIntersecting : false),
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	return (
		<>
			<div ref={sentinel} aria-hidden className="h-px" />
			<Tag
				{...rest}
				data-stuck={stuck || undefined}
				className={`scroll-edge ${className}`}
			>
				{children}
			</Tag>
		</>
	);
}
