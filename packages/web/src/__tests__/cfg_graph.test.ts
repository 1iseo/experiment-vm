import { describe, expect, it } from "vitest";
import type { BytecodeDebugMap } from "@experiment-vm/vm/ir_lower";
import type { BasicBlock, IRFunction, Instruction, Terminator } from "@experiment-vm/vm/ir_v2";
import {
	buildBlockCfg,
	debugRangeForGraphBlock,
	graphBlockIdForDebugRange,
	toDot,
} from "../cfg_graph.js";

const meta = { isJunk: false, pinned: false, cloneWeight: 0 };

function inst(id: string): Instruction {
	return {
		id,
		type: "Const",
		value: id,
		deps: [],
		meta,
	};
}

function block(id: string, instCount: number, term: Terminator): BasicBlock {
	return {
		id,
		insts: Array.from({ length: instCount }, (_, index) => inst(`${id}_v${index}`)),
		term,
		meta,
		catchTarget: null,
	};
}

function fn(blocks: BasicBlock[], entry = blocks[0].id): IRFunction {
	return {
		id: "fn",
		params: [],
		blocks: new Map(blocks.map((basicBlock) => [basicBlock.id, basicBlock])),
		entry,
		memLayout: {},
	};
}

function debugMap(blockRanges: BytecodeDebugMap["blockRanges"]): BytecodeDebugMap {
	return {
		blockRanges,
		instructionRanges: [],
		terminatorRanges: [],
	};
}

describe("CFG graph helpers", () => {
	it("extracts a straight-line return block", () => {
		const graph = buildBlockCfg("fn", fn([
			block("b_entry", 1, { type: "Ret", val: "b_entry_v0", meta }),
		]));

		expect(graph.nodes).toEqual([
			expect.objectContaining({
				id: "b_entry",
				instructionCount: 1,
				terminatorType: "Ret",
				isEntry: true,
				isReturn: true,
			}),
		]);
		expect(graph.edges).toEqual([]);
	});

	it("extracts true and false edges for branches", () => {
		const graph = buildBlockCfg("fn", fn([
			block("b_entry", 1, { type: "Br", cond: "b_entry_v0", trueTarget: "b_then", falseTarget: "b_else", meta }),
			block("b_then", 1, { type: "Ret", val: "b_then_v0", meta }),
			block("b_else", 1, { type: "Ret", val: "b_else_v0", meta }),
		]));

		expect(graph.edges).toEqual([
			{ from: "b_entry", to: "b_then", label: "true" },
			{ from: "b_entry", to: "b_else", label: "false" },
		]);
	});

	it("extracts case and default edges for switches", () => {
		const graph = buildBlockCfg("fn", fn([
			block("b_entry", 1, {
				type: "Switch",
				cond: "b_entry_v0",
				cases: { "1": "b_one", two: "b_two" },
				defaultTarget: "b_default",
				meta,
			}),
			block("b_one", 0, { type: "Ret", val: null, meta }),
			block("b_two", 0, { type: "Ret", val: null, meta }),
			block("b_default", 0, { type: "Ret", val: null, meta }),
		]));

		expect(graph.edges).toEqual([
			{ from: "b_entry", to: "b_one", label: "case 1" },
			{ from: "b_entry", to: "b_two", label: "case two" },
			{ from: "b_entry", to: "b_default", label: "default" },
		]);
	});

	it("keeps loop back edges", () => {
		const graph = buildBlockCfg("fn", fn([
			block("b_entry", 0, { type: "Jmp", target: "b_loop", meta }),
			block("b_loop", 1, { type: "Br", cond: "b_loop_v0", trueTarget: "b_loop", falseTarget: "b_exit", meta }),
			block("b_exit", 0, { type: "Ret", val: null, meta }),
		]));

		expect(graph.edges).toContainEqual({ from: "b_loop", to: "b_loop", label: "true" });
	});

	it("attaches bytecode ranges from the debug map", () => {
		const graph = buildBlockCfg("fn", fn([
			block("b_entry", 0, { type: "Ret", val: null, meta }),
		]), debugMap([
			{ funcId: "fn", blockId: "b_entry", startPc: 24, endPc: 51 },
		]));

		expect(graph.nodes[0].bytecodeRange).toEqual({ startPc: 24, endPc: 51 });
		expect(graph.nodes[0].label).toContain("pc 24-51");
	});

	it("escapes DOT ids and labels", () => {
		const graph = buildBlockCfg("fn\"x", fn([
			block("b \"quoted\"", 1, { type: "Ret", val: "b \"quoted\"_v0", meta }),
		], "b \"quoted\""));

		const dot = toDot(graph);

		expect(dot).toContain("digraph \"cfg_fn\\\"x\"");
		expect(dot).toContain("\"b \\\"quoted\\\"\" [label=\"b \\\"quoted\\\"\\n1 inst\\nRet\"");
	});

	it("maps graph blocks to existing debug ranges", () => {
		const graph = buildBlockCfg("fn", fn([
			block("b_entry", 0, { type: "Ret", val: null, meta }),
		]));
		const ranges = [
			{ id: "inst", kind: "instruction", funcId: "fn", blockId: "b_entry", startPc: 2, endPc: 4 },
			{ id: "block", kind: "block", funcId: "fn", blockId: "b_entry", startPc: 0, endPc: 8 },
		];

		expect(debugRangeForGraphBlock(graph, ranges, "b_entry")).toMatchObject({ id: "block" });
		expect(graphBlockIdForDebugRange(graph, ranges[0])).toBe("b_entry");
		expect(graphBlockIdForDebugRange(graph, { ...ranges[0], funcId: "other" })).toBeUndefined();
	});
});
