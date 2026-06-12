import type { BytecodeDebugMap } from "@experiment-vm/vm/ir_lower";
import type { BlockId, IRFunction, Terminator } from "@experiment-vm/vm/ir_v2";

export type BytecodeRange = {
	startPc: number;
	endPc: number;
};

export type BlockCfgNode = {
	id: BlockId;
	label: string;
	instructionCount: number;
	terminatorType: Terminator["type"];
	isEntry: boolean;
	isReturn: boolean;
	bytecodeRange?: BytecodeRange;
};

export type BlockCfgEdge = {
	from: BlockId;
	to: BlockId;
	label?: string;
};

export type BlockCfgGraph = {
	functionId: string;
	entryBlockId: BlockId;
	nodes: BlockCfgNode[];
	edges: BlockCfgEdge[];
};

export type DebugRangeLike = {
	funcId?: string;
	blockId: string;
	kind?: string;
	startPc: number;
	endPc: number;
};

export function buildBlockCfg(
	functionId: string,
	irFunction: IRFunction,
	debugMap?: BytecodeDebugMap,
): BlockCfgGraph {
	const rangesByBlock = new Map<BlockId, BytecodeRange>();
	for (const range of debugMap?.blockRanges ?? []) {
		if (range.funcId !== undefined && range.funcId !== functionId) {
			continue;
		}
		rangesByBlock.set(range.blockId, {
			startPc: range.startPc,
			endPc: range.endPc,
		});
	}

	const nodes: BlockCfgNode[] = [];
	const edges: BlockCfgEdge[] = [];
	for (const block of irFunction.blocks.values()) {
		const bytecodeRange = rangesByBlock.get(block.id);
		nodes.push({
			id: block.id,
			label: formatNodeLabel(block.id, block.insts.length, block.term.type, bytecodeRange),
			instructionCount: block.insts.length,
			terminatorType: block.term.type,
			isEntry: block.id === irFunction.entry,
			isReturn: block.term.type === "Ret",
			bytecodeRange,
		});
		edges.push(...edgesForTerminator(block.id, block.term));
	}

	return {
		functionId,
		entryBlockId: irFunction.entry,
		nodes,
		edges,
	};
}

export function toDot(graph: BlockCfgGraph): string {
	const lines = [
		`digraph ${dotQuote(`cfg_${graph.functionId}`)} {`,
		"  graph [rankdir=TB, bgcolor=\"transparent\", pad=\"0.12\", nodesep=\"0.35\", ranksep=\"0.45\"];",
		"  node [shape=box, style=\"rounded,filled\", fontname=\"Cascadia Code\", fontsize=10, margin=\"0.08,0.06\", color=\"#9eacb8\", fillcolor=\"#ffffff\"];",
		"  edge [fontname=\"Inter\", fontsize=9, color=\"#7b8a98\", fontcolor=\"#536170\", arrowsize=0.7];",
	];

	for (const node of graph.nodes) {
		const classes = ["cfg-node"];
		if (node.isEntry) {
			classes.push("cfg-entry");
		}
		if (node.isReturn) {
			classes.push("cfg-return");
		}
		lines.push(
			`  ${dotQuote(node.id)} [label=${dotQuote(node.label)}, class=${dotQuote(classes.join(" "))}];`,
		);
	}

	for (const edge of graph.edges) {
		const label = edge.label === undefined ? "" : ` [label=${dotQuote(edge.label)}]`;
		lines.push(`  ${dotQuote(edge.from)} -> ${dotQuote(edge.to)}${label};`);
	}

	lines.push("}");
	return lines.join("\n");
}

export function debugRangeForGraphBlock<T extends DebugRangeLike>(
	graph: BlockCfgGraph,
	ranges: readonly T[],
	blockId: string,
): T | undefined {
	const candidates = ranges.filter((range) =>
		range.blockId === blockId
		&& (range.funcId === undefined || range.funcId === graph.functionId)
	);
	return candidates.find((range) => range.kind === "block") ?? candidates[0];
}

export function graphBlockIdForDebugRange(
	graph: BlockCfgGraph,
	range: Pick<DebugRangeLike, "funcId" | "blockId"> | undefined,
): string | undefined {
	if (!range) {
		return undefined;
	}
	if (range.funcId !== undefined && range.funcId !== graph.functionId) {
		return undefined;
	}
	return graph.nodes.some((node) => node.id === range.blockId) ? range.blockId : undefined;
}

function edgesForTerminator(from: BlockId, term: Terminator): BlockCfgEdge[] {
	if (term.type === "Jmp") {
		return [{ from, to: term.target }];
	}
	if (term.type === "Br") {
		return [
			{ from, to: term.trueTarget, label: "true" },
			{ from, to: term.falseTarget, label: "false" },
		];
	}
	if (term.type === "Switch") {
		const edges = Object.entries(term.cases).map(([value, target]) => ({
			from,
			to: target,
			label: `case ${value}`,
		}));
		edges.push({ from, to: term.defaultTarget, label: "default" });
		return edges;
	}
	return [];
}

function formatNodeLabel(
	blockId: BlockId,
	instructionCount: number,
	terminatorType: Terminator["type"],
	bytecodeRange: BytecodeRange | undefined,
): string {
	const instLabel = instructionCount === 1 ? "1 inst" : `${instructionCount} insts`;
	const lines = [blockId, instLabel, terminatorType];
	if (bytecodeRange) {
		lines.push(`pc ${bytecodeRange.startPc}-${bytecodeRange.endPc}`);
	}
	return lines.join("\n");
}

function dotQuote(value: string): string {
	return `"${value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, "\\\"")
		.replace(/\r\n|\r|\n/g, "\\n")}"`;
}
