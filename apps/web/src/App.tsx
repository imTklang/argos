import { Radar } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useStats } from "./api.ts";
import { JobDrawer } from "./components/JobDrawer.tsx";
import { JobsPage } from "./pages/JobsPage.tsx";
import { KanbanPage } from "./pages/KanbanPage.tsx";
import { PreferencesPage } from "./pages/PreferencesPage.tsx";

const TABS = [
	["vagas", "Vagas"],
	["kanban", "Kanban"],
	["preferencias", "Preferências"],
] as const;
type Tab = (typeof TABS)[number][0];

function tabFromHash(): Tab {
	const hash = window.location.hash.replace("#", "");
	return TABS.some(([id]) => id === hash) ? (hash as Tab) : "vagas";
}

function Stats() {
	const { data } = useStats();
	if (!data) return null;
	const items: [string, number][] = [
		["novas", data.byStatus.nova],
		["salvas", data.byStatus.salva],
		["candidaturas", data.byStatus.candidatei],
	];
	return (
		<dl className="hidden gap-4 text-sm sm:flex">
			{items.map(([label, value]) => (
				<div key={label} className="flex items-baseline gap-1">
					<dt className="sr-only">{label}</dt>
					<dd className="font-semibold tabular-nums">{value}</dd>
					<span aria-hidden className="text-muted">
						{label}
					</span>
				</div>
			))}
		</dl>
	);
}

export function App() {
	const [tab, setTab] = useState<Tab>(tabFromHash);
	const [openJob, setOpenJob] = useState<number | null>(null);
	// Stable so the drawer's Escape listener is not re-bound every render.
	const closeJob = useCallback(() => setOpenJob(null), []);

	useEffect(() => {
		const onHash = () => setTab(tabFromHash());
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);

	return (
		<div className="min-h-dvh">
			<header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
				<div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
					<h1 className="flex items-center gap-2 font-semibold">
						<Radar aria-hidden size={20} className="text-accent" />
						Radar de Estágio
					</h1>
					<Stats />
				</div>
				<nav className="mx-auto flex max-w-5xl gap-1 px-4" aria-label="Seções">
					{TABS.map(([id, label]) => (
						<a
							key={id}
							href={`#${id}`}
							aria-current={tab === id ? "page" : undefined}
							className={`-mb-px border-b-2 px-3 py-2 text-sm ${
								tab === id
									? "border-accent font-medium text-ink"
									: "border-transparent text-muted hover:text-ink"
							}`}
						>
							{label}
						</a>
					))}
				</nav>
			</header>

			<main
				className={`mx-auto px-4 py-5 ${tab === "kanban" ? "max-w-none" : "max-w-5xl"}`}
			>
				{tab === "vagas" && <JobsPage onOpen={setOpenJob} />}
				{tab === "kanban" && <KanbanPage onOpen={setOpenJob} />}
				{tab === "preferencias" && <PreferencesPage />}
			</main>

			{openJob !== null && <JobDrawer jobId={openJob} onClose={closeJob} />}
		</div>
	);
}
