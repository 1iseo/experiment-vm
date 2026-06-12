import { fileURLToPath, URL } from "node:url";

export const vmAliases = [
	{
		find: "@experiment-vm/vm/disassemble",
		replacement: fileURLToPath(new URL("../vm/src/disassemble.ts", import.meta.url)),
	},
	{
		find: "@experiment-vm/vm/ir_lower",
		replacement: fileURLToPath(new URL("../vm/src/ir_lower.ts", import.meta.url)),
	},
	{
		find: "@experiment-vm/vm/ir_v2",
		replacement: fileURLToPath(new URL("../vm/src/ir_v2.ts", import.meta.url)),
	},
	{
		find: "@experiment-vm/vm/vm",
		replacement: fileURLToPath(new URL("../vm/src/vm.ts", import.meta.url)),
	},
	{
		find: "@experiment-vm/vm",
		replacement: fileURLToPath(new URL("../vm/src/index.ts", import.meta.url)),
	},
];

export default ({ mode }) => ({
	resolve: {
		alias: vmAliases,
	},
	define: {
		"process.env.BABEL_TYPES_8_BREAKING": "false",
		"process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development"),
	},
});
