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
		<label className="flex h-9 items-center gap-1.5 rounded-[10px] bg-fill px-2.5 text-muted focus-within:outline-2 focus-within:outline-accent">
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

/** iOS segmented control on real radio inputs: arrow keys work for free. */
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
	return (
		<fieldset className="col-span-2 flex rounded-[9px] bg-fill p-0.5">
			<legend className="sr-only">{label}</legend>
			{options.map(([option, text]) => (
				<label key={option} className="flex-1 cursor-pointer">
					<input
						type="radio"
						name={name}
						value={option}
						checked={value === option}
						onChange={() => onChange(option)}
						className="peer sr-only"
					/>
					<span className="block rounded-[7px] px-3 py-1 text-center text-[13px] font-medium peer-checked:bg-thumb peer-checked:font-semibold peer-checked:shadow-[0_1px_3px_rgb(0_0_0/0.12)] peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
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
				className="h-8 w-full cursor-pointer appearance-none rounded-[9px] bg-fill pr-7 pl-3 text-[13px] font-medium text-ink"
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
				className="pointer-events-none absolute right-2 text-muted"
			/>
		</label>
	);
}
