import {
	Columns3,
	type LucideIcon,
	Radar,
	Settings,
	Sparkles,
} from "lucide-react";
import { useStats } from "../api.ts";
import { ago } from "../format.ts";
import { isList, LIST_IDS, LISTS, listCount, type Route } from "../routes.ts";

function SidebarLink({
	href,
	label,
	Icon,
	current,
	count,
}: {
	href: string;
	label: string;
	Icon: LucideIcon;
	current: boolean;
	count?: number | null;
}) {
	return (
		<li>
			<a
				href={href}
				aria-current={current ? "page" : undefined}
				className={`flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] ${
					current ? "bg-fill-strong font-semibold" : "hoverable"
				}`}
			>
				<Icon aria-hidden size={16} className="shrink-0 text-accent" />
				<span className="flex-1 truncate">{label}</span>
				{count ? (
					<span className="text-xs text-muted tabular-nums">{count}</span>
				) : null}
			</a>
		</li>
	);
}

function SidebarGroup({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-0.5">
			<h2 className="px-2.5 pt-4 pb-1 text-[11px] font-semibold text-muted">
				{title}
			</h2>
			<ul className="space-y-0.5">{children}</ul>
		</div>
	);
}

/** When the worker last looked for jobs, and whether any source failed. */
function LastScan() {
	const { data } = useStats();
	const finished = (data?.lastRuns ?? [])
		.map((run) => run.finishedAt)
		.filter((at): at is string => at !== null)
		.sort()
		.at(-1);
	if (!data || !finished) return null;
	const failed = data.lastRuns.filter((run) => run.errors?.length).length;
	return (
		<p className="flex items-center gap-2 px-2.5 text-xs text-muted">
			<span
				aria-hidden
				className={`size-2 rounded-full ${failed ? "bg-warn" : "bg-good"}`}
			/>
			<span>
				Varredura {ago(finished)}
				{failed > 0 &&
					` · ${failed} ${failed === 1 ? "fonte falhou" : "fontes falharam"}`}
			</span>
		</p>
	);
}

/** macOS-style source list on wide screens. */
export function Sidebar({ route }: { route: Route }) {
	const { data } = useStats();
	return (
		<nav
			aria-label="Seções"
			className="material hidden w-60 shrink-0 flex-col border-r border-separator px-3 pb-4 md:flex"
		>
			<p className="flex items-center gap-2 px-2.5 pt-5 pb-1 text-[15px] font-semibold">
				<span className="grid size-7 place-items-center rounded-[8px] bg-accent-fill text-on-accent">
					<Radar aria-hidden size={16} strokeWidth={2.25} />
				</span>
				Radar de Estágio
			</p>
			<SidebarGroup title="Vagas">
				{LIST_IDS.map((id) => (
					<SidebarLink
						key={id}
						href={`#/${id}`}
						label={LISTS[id].label}
						Icon={LISTS[id].Icon}
						current={route === id}
						count={listCount(data, id)}
					/>
				))}
			</SidebarGroup>
			<SidebarGroup title="Organizar">
				<SidebarLink
					href="#/quadro"
					label="Quadro"
					Icon={Columns3}
					current={route === "quadro"}
				/>
			</SidebarGroup>
			<div className="mt-auto space-y-3">
				<ul>
					<SidebarLink
						href="#/ajustes"
						label="Ajustes"
						Icon={Settings}
						current={route === "ajustes"}
					/>
				</ul>
				<LastScan />
			</div>
		</nav>
	);
}

const TABS: {
	href: string;
	label: string;
	Icon: LucideIcon;
	match: (r: Route) => boolean;
}[] = [
	{ href: "#/para-voce", label: "Vagas", Icon: Sparkles, match: isList },
	{
		href: "#/quadro",
		label: "Quadro",
		Icon: Columns3,
		match: (r) => r === "quadro",
	},
	{
		href: "#/ajustes",
		label: "Ajustes",
		Icon: Settings,
		match: (r) => r === "ajustes",
	},
];

/** Floating tab bar on phones, as in iOS. */
export function TabBar({ route }: { route: Route }) {
	return (
		<nav
			aria-label="Seções"
			className="material fixed bottom-[max(env(safe-area-inset-bottom),0.75rem)] left-1/2 z-30 -translate-x-1/2 rounded-full border border-separator p-1 shadow-[0_8px_30px_rgb(0_0_0/0.12)] md:hidden"
		>
			<ul className="flex">
				{TABS.map(({ href, label, Icon, match }) => {
					const current = match(route);
					return (
						<li key={href}>
							<a
								href={href}
								aria-current={current ? "page" : undefined}
								className={`pressable flex w-20 flex-col items-center gap-0.5 rounded-full py-1.5 text-[10px] font-semibold ${
									current ? "bg-fill text-accent" : "text-ink"
								}`}
							>
								<Icon
									aria-hidden
									size={22}
									strokeWidth={current ? 2.25 : 1.75}
								/>
								{label}
							</a>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}

/** Smart lists as chips, for phones where there is no sidebar. */
export function ListChips({ route }: { route: Route }) {
	return (
		<nav
			aria-label="Listas"
			className="no-scrollbar -mx-4 overflow-x-auto px-4 md:hidden"
		>
			<ul className="flex gap-2">
				{LIST_IDS.map((id) => (
					<li key={id}>
						<a
							href={`#/${id}`}
							aria-current={route === id ? "page" : undefined}
							className={`pressable flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap ${
								route === id
									? "bg-accent-fill text-on-accent font-semibold"
									: "bg-fill"
							}`}
						>
							{LISTS[id].label}
						</a>
					</li>
				))}
			</ul>
		</nav>
	);
}
