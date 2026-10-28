import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { App } from "./App.tsx";
import "./index.css";

const client = new QueryClient({
	defaultOptions: {
		queries: { staleTime: 30_000, refetchOnWindowFocus: true },
	},
});

const root = document.getElementById("root");
if (!root) throw new Error("#root não encontrado");

createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={client}>
			<App />
			<Toaster position="bottom-right" richColors closeButton theme="system" />
		</QueryClientProvider>
	</StrictMode>,
);
