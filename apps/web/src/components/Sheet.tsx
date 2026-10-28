import { useCallback, useEffect, useRef, useState } from "react";

/** Spread on the sheet's header so it can be dragged down to close. */
export type DragHandle = {
	onPointerDown: (event: React.PointerEvent) => void;
	onPointerMove: (event: React.PointerEvent) => void;
	onPointerUp: (event: React.PointerEvent) => void;
	onPointerCancel: (event: React.PointerEvent) => void;
};

const EXIT_MS = 240;

/**
 * A modal sheet: from the bottom on phones (drag the header down to close),
 * a floating panel from the right on wider screens.
 */
export function Sheet({
	labelledBy,
	onClose,
	children,
}: {
	labelledBy: string;
	onClose: () => void;
	children: (sheet: {
		close: () => void;
		handle: DragHandle;
	}) => React.ReactNode;
}) {
	const panel = useRef<HTMLDivElement>(null);
	const drag = useRef<{ id: number; y: number; t: number; dy: number } | null>(
		null,
	);
	const [closing, setClosing] = useState(false);
	const close = useCallback(() => setClosing(true), []);

	// Unmount once the exit transition has played.
	useEffect(() => {
		if (!closing) return;
		const timer = setTimeout(onClose, EXIT_MS);
		return () => clearTimeout(timer);
	}, [closing, onClose]);

	useEffect(() => {
		const returnTo = document.activeElement as HTMLElement | null;
		panel.current?.focus();
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
		document.addEventListener("keydown", onKey);
		const overflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = overflow;
			returnTo?.focus();
		};
	}, [close]);

	const handle: DragHandle = {
		onPointerDown(event) {
			// Only the bottom sheet drags; the side panel closes with its button.
			if (window.matchMedia("(min-width: 768px)").matches) return;
			if ((event.target as HTMLElement).closest("button, a, input, textarea"))
				return;
			drag.current = {
				id: event.pointerId,
				y: event.clientY,
				t: performance.now(),
				dy: 0,
			};
			event.currentTarget.setPointerCapture(event.pointerId);
			panel.current?.setAttribute("data-dragging", "");
		},
		onPointerMove(event) {
			const state = drag.current;
			// Extra fingers are ignored once a drag has started.
			if (!state || state.id !== event.pointerId || !panel.current) return;
			const dy = event.clientY - state.y;
			// Upward is allowed but resists, instead of hitting a wall.
			state.dy = dy > 0 ? dy : dy * 0.2;
			panel.current.style.transform = `translateY(${state.dy}px)`;
		},
		onPointerUp(event) {
			const state = drag.current;
			if (!state || state.id !== event.pointerId || !panel.current) return;
			drag.current = null;
			const velocity = state.dy / (performance.now() - state.t);
			const height = panel.current.offsetHeight;
			panel.current.removeAttribute("data-dragging");
			// Clearing the inline transform lets CSS animate from where it is.
			panel.current.style.transform = "";
			// A quick flick is enough; no need to drag past a threshold.
			if (state.dy > height * 0.25 || (state.dy > 10 && velocity > 0.11)) {
				close();
			}
		},
		onPointerCancel() {
			drag.current = null;
			panel.current?.removeAttribute("data-dragging");
			if (panel.current) panel.current.style.transform = "";
		},
	};

	return (
		<div
			className="sheet-root fixed inset-0 z-40"
			data-closing={closing || undefined}
		>
			<button
				type="button"
				aria-label="Fechar"
				tabIndex={-1}
				onClick={close}
				className="scrim absolute inset-0 cursor-default bg-black/30"
			/>
			<div
				ref={panel}
				role="dialog"
				aria-modal="true"
				aria-labelledby={labelledBy}
				tabIndex={-1}
				className="sheet absolute inset-x-0 top-3 bottom-0 overflow-y-auto overscroll-contain rounded-t-[14px] bg-bg shadow-2xl outline-none md:inset-y-2 md:right-2 md:left-auto md:w-[min(34rem,calc(100%-1rem))] md:rounded-2xl"
			>
				{children({ close, handle })}
			</div>
		</div>
	);
}
