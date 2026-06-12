import { defineConfig } from "vitest/config";
import { vmAliases } from "./vite.config.js";

export default defineConfig({
	resolve: {
		alias: vmAliases,
	},
	test: {
		environment: "node",
	},
});
