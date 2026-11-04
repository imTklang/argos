/**
 * The Argos mark: the eye of Argos Panoptes, its iris a peacock-feather
 * ocellus, ringed by the hundred eyes as a radar sweep. Drawn in
 * public/favicon.svg so the page, the tab and the home screen share it.
 */
export function Logo({ size = 28 }: { size?: number }) {
	return (
		<img
			src="/favicon.svg"
			alt=""
			width={size}
			height={size}
			className="shrink-0 rounded-[22.5%] shadow-[0_1px_2px_rgb(0_0_0/0.2),0_4px_12px_-4px_rgb(43_35_120/0.45)]"
		/>
	);
}
