import { useCallback, useEffect, useState } from "react";
import { JobDetail } from "./components/JobDetail.tsx";
import { Sidebar, TabBar } from "./components/Navigation.tsx";
import { Sheet } from "./components/Sheet.tsx";
import { useMediaQuery } from "./hooks.ts";
import { JobsPage } from "./pages/JobsPage.tsx";
import { KanbanPage } from "./pages/KanbanPage.tsx";
import { PreferencesPage } from "./pages/PreferencesPage.tsx";
import { isList, type Route, routeFromHash } from "./routes.ts";

export function App() {
	const [route, setRoute] = useState<Route>(() =>
		routeFromHash(window.location.hash),
	);
	const [openJob, setOpenJob] = useState<number | null>(null);
	// Stable so the sheet's Escape listener is not re-bound every render.
	const closeJob = useCallback(() => setOpenJob(null), []);
	// Wide enough for sidebar, list and details side by side, as in Mail.
	const wide = useMediaQuery("(min-width: 1280px)");
	const inline = wide && isList(route);

	useEffect(() => {
		const onHash = () => {
			setRoute(routeFromHash(window.location.hash));
			setOpenJob(null);
		};
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);

	return (
		<div className="min-h-dvh md:flex md:h-dvh md:overflow-hidden">
			<Sidebar route={route} />
			<main
				className={`min-w-0 flex-1 ${inline ? "md:overflow-hidden" : "md:overflow-y-auto"}`}
			>
				{isList(route) && (
					// A new list starts with its own filters.
					<JobsPage
						key={route}
						list={route}
						inline={inline}
						selected={openJob}
						onOpen={setOpenJob}
					/>
				)}
				{route === "quadro" && <KanbanPage onOpen={setOpenJob} />}
				{route === "ajustes" && <PreferencesPage />}
			</main>
			<TabBar route={route} />

			{openJob !== null && !inline && (
				<Sheet labelledBy="sheet-title" onClose={closeJob}>
					{({ close, handle }) => (
						<JobDetail
							jobId={openJob}
							titleId="sheet-title"
							onClose={close}
							handle={handle}
						/>
					)}
				</Sheet>
			)}
		</div>
	);
}
