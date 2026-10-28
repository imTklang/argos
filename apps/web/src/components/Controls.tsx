import { ChevronsUpDown, Search } from "lucide-react";
import { useId } from "react";

export function SearchField({
	value,
	onChange,
	label,
}: {
	value: string;
	onChange: (value: string) => void;
	label: string;
}) {
	return (
		<label className="flex h-9 items-center gap-1.5 rounded-full bg-fill px-3 text-muted focus-within:outline-2 focus-within:outline-accent">
			<Search aria-hidden size={16} className="shrink-0" />
			<input
				type="search"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={label}
				aria-label={label}
				className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
			/>
		</label>
	);
}

/**
 * iOS segmented control on real radio inputs, so arrow keys work for free.
 * The selected thumb slides between segments with a spring.
 */
export function Segmented<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: [T, string][];
	onChange: (value: T) => void;
}) {
	const name = useId();
	const index = Math.max(
		0,
		options.findIndex(([option]) => option === value),
	);
	return (
		<fieldset className="relative col-span-2 flex rounded-full bg-fill p-0.5">
			<legend className="sr-only">{label}</legend>
			<span
				aria-hidden
				className="slider-thumb absolute inset-y-0.5 left-0.5 rounded-full bg-thumb shadow-[0_1px_3px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.04)]"
				style={{
					width: `calc((100% - 4px) / ${options.length})`,
					transform: `translateX(${index * 100}%)`,
				}}
			/>
			{options.map(([option, text]) => (
				<label key={option} className="relative flex-1 cursor-pointer">
					<input
						type="radio"
						name={name}
						value={option}
						checked={value === option}
						onChange={() => onChange(option)}
						className="peer sr-only"
					/>
					<span className="block rounded-full px-3 py-1 text-center text-[13px] font-medium peer-checked:font-semibold peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
						{text}
					</span>
				</label>
			))}
		</fieldset>
	);
}

/** A pop-up button: the native select, so the system draws the menu. */
export function PopUp<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: [T, string][];
	onChange: (value: T) => void;
}) {
	return (
		<label className="relative flex items-center">
			<span className="sr-only">{label}</span>
			<select
				value={value}
				onChange={(e) => onChange(e.target.value as T)}
				className="h-8 w-full cursor-pointer appearance-none rounded-full bg-fill pr-7 pl-3.5 text-[13px] font-medium text-ink"
			>
				{options.map(([option, text]) => (
					<option key={option} value={option}>
						{text}
					</option>
				))}
			</select>
			<ChevronsUpDown
				aria-hidden
				size={13}
				className="pointer-events-none absolute right-2.5 text-muted"
			/>
		</label>
	);
}
