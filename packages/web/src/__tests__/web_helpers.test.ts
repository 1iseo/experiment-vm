import { describe, expect, it } from "vitest";
import type { DisassembledInstruction } from "@experiment-vm/vm/disassemble";
import type { BytecodeDebugMap } from "@experiment-vm/vm/ir_lower";
import {
	bestDebugRangeForOffset,
	buildLabels,
	disassemblyOffsetsForRange,
	flattenDebugRanges,
	formatBytecodeHex,
	formatConstantPool,
} from "../ui_helpers.js";

const debugMap: BytecodeDebugMap = {
	blockRanges: [
		{ funcId: "func_main", blockId: "b_entry", startPc: 0, endPc: 10 },
		{ funcId: "func_main", blockId: "b_next", startPc: 10, endPc: 16 },
	],
	instructionRanges: [
		{ funcId: "func_main", blockId: "b_entry", irId: "v_0", irType: "Const", startPc: 0, endPc: 2 },
		{ funcId: "func_main", blockId: "b_entry", irId: "v_1", irType: "BinOp", startPc: 2, endPc: 8 },
	],
	terminatorRanges: [
		{ funcId: "func_main", blockId: "b_entry", termType: "Jmp", startPc: 8, endPc: 10 },
	],
};

const rows: DisassembledInstruction[] = [
	{ offset: 0, opcode: 1, opcodeName: "PUSH_CONST", operands: [], size: 2, bytes: [1, 0] },
	{ offset: 2, opcode: 1, opcodeName: "PUSH_CONST", operands: [], size: 2, bytes: [1, 1] },
	{ offset: 4, opcode: 0x30, opcodeName: "ADD", operands: [], size: 1, bytes: [0x30] },
	{ offset: 8, opcode: 0x70, opcodeName: "JMP", operands: [], size: 3, bytes: [0x70, 0, 10] },
	{ offset: 10, opcode: 0x82, opcodeName: "RET", operands: [], size: 1, bytes: [0x82] },
];

describe("web UI helpers", () => {
	it("formats bytecode as fixed-width hex lines", () => {
		expect(formatBytecodeHex(new Uint8Array([1, 2, 255, 16]), 2)).toBe("0000: 01 02\n0002: ff 10");
	});

	it("formats constant pool previews", () => {
		expect(formatConstantPool([undefined, "x", { a: 1 }])).toEqual([
			{ index: 0, preview: "undefined" },
			{ index: 1, preview: '"x"' },
			{ index: 2, preview: '{"a":1}' },
		]);
	});

	it("builds labels from block ranges", () => {
		expect(buildLabels(debugMap)).toEqual({
			0: "func_main:b_entry",
			10: "func_main:b_next",
		});
	});

	it("flattens debug ranges in bytecode order", () => {
		const ranges = flattenDebugRanges(debugMap);

		expect(ranges.map((range) => range.kind)).toEqual([
			"block",
			"instruction",
			"instruction",
			"terminator",
			"block",
		]);
		expect(ranges[1]).toMatchObject({ label: "func_main:v_0", detail: "Const in b_entry" });
	});

	it("matches disassembly offsets for a debug range", () => {
		const range = flattenDebugRanges(debugMap).find((candidate) => candidate.id.startsWith("inst:") && candidate.label.endsWith("v_1"));

		expect(range).toBeDefined();
		expect(disassemblyOffsetsForRange(rows, range!)).toEqual([2, 4]);
	});

	it("selects the most specific debug range for a disassembly offset", () => {
		const ranges = flattenDebugRanges(debugMap);

		expect(bestDebugRangeForOffset(ranges, 4)).toMatchObject({ kind: "instruction", label: "func_main:v_1" });
		expect(bestDebugRangeForOffset(ranges, 8)).toMatchObject({ kind: "terminator", detail: "Jmp terminator" });
		expect(bestDebugRangeForOffset(ranges, 14)).toMatchObject({ kind: "block", label: "func_main:b_next" });
	});
});
