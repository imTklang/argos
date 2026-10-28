import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		// The API (pnpm api) listens on 127.0.0.1:3333.
		proxy: { "/api": "http://127.0.0.1:3333" },
	},
});
