import * as parser from "@babel/parser";
import { describe, expect, it } from "vitest";
import { disassembleBytecode, formatDisassembly } from "../disassemble.js";
import { lowerIRFunctionToBytecode, lowerIRProgramToBytecode } from "../ir_lower.js";
import { translateFunctionToObfuscatedIR, translateProgramToObfuscatedIR } from "../ir_v2.js";
import { Opcode } from "../vm.js";
import * as t from "@babel/types";

function getFirstFunction(code: string) {
	const ast = parser.parse(code, { sourceType: "module" });
	const fn = ast.program.body.find(
		(node): node is t.FunctionDeclaration => node.type === "FunctionDeclaration",
	);
	if (!fn) {
		throw new Error("Expected a FunctionDeclaration");
	}
	return fn;
}

function opcodeNames(bytecode: Uint8Array, constantPool: unknown[] = []) {
	return disassembleBytecode(bytecode, { constantPool }).map((inst) => inst.opcodeName);
}

describe("disassembleBytecode", () => {
	it("decodes stack, constant, arithmetic, memory, and return opcodes", () => {
		const bytecode = new Uint8Array([
			Opcode.PUSH_CONST, 0,
			Opcode.PUSH_CONST, 1,
			Opcode.ADD,
			Opcode.PUSH_CONST, 2,
			Opcode.STORE,
			Opcode.PUSH_CONST, 2,
			Opcode.LOAD,
			Opcode.RET,
		]);
		const rows = disassembleBytecode(bytecode, { constantPool: [2, 3, 10] });

		expect(rows.map((row) => row.opcodeName)).toEqual([
			"PUSH_CONST",
			"PUSH_CONST",
			"ADD",
			"PUSH_CONST",
			"STORE",
			"PUSH_CONST",
			"LOAD",
			"RET",
		]);
		expect(rows[0].operands[0]).toMatchObject({ type: "const", index: 0, value: 2 });
		expect(formatDisassembly(rows)).toContain("0000 PUSH_CONST #0");
	});

	it("decodes jump operands and labels", () => {
		const bytecode = new Uint8Array([
			Opcode.JMP_IF, 0, 6,
			Opcode.JMP, 0, 9,
			Opcode.RET,
		]);
		const rows = disassembleBytecode(bytecode, {
			labels: { 6: "then", 9: "end" },
		});

		expect(rows[0].operands[0]).toMatchObject({ type: "offset", value: 6, label: "then" });
		expect(rows[1].operands[0]).toMatchObject({ type: "offset", value: 9, label: "end" });
		expect(formatDisassembly(rows)).toContain("JMP_IF then(0006)");
	});

	it("decodes wide constants and wide jumps", () => {
		const bytecode = new Uint8Array([
			Opcode.PUSH_CONST_W, 1, 44,
			Opcode.JMP_IF_W, 0, 1, 0, 12,
			Opcode.JMP_W, 0, 1, 0, 20,
		]);
		const rows = disassembleBytecode(bytecode, {
			constantPool: Array.from({ length: 301 }, (_, index) => index),
			labels: { 65548: "then", 65556: "end" },
		});

		expect(rows[0].operands[0]).toMatchObject({ type: "const", index: 300, value: 300 });
		expect(rows[1].operands[0]).toMatchObject({ type: "offset", value: 65548, label: "then" });
		expect(rows[2].operands[0]).toMatchObject({ type: "offset", value: 65556, label: "end" });
	});

	it("decodes dispatch tables", () => {
		const bytecode = new Uint8Array([
			Opcode.DISPATCH,
			2,
			0, 0, 20,
			1, 0, 30,
			0, 40,
		]);
		const rows = disassembleBytecode(bytecode, {
			constantPool: ["a", "b"],
			labels: { 20: "caseA", 30: "caseB", 40: "default" },
		});

		expect(rows).toHaveLength(1);
		expect(rows[0].operands[0]).toMatchObject({
			type: "dispatch",
			cases: [
				{ constIndex: 0, value: "a", target: 20, label: "caseA" },
				{ constIndex: 1, value: "b", target: 30, label: "caseB" },
			],
			defaultTarget: 40,
			defaultLabel: "default",
		});
		expect(formatDisassembly(rows)).toContain('"a":caseA(0020)');
	});

	it("decodes wide dispatch tables", () => {
		const bytecode = new Uint8Array([
			Opcode.DISPATCH_W,
			1,
			1, 44, 0, 1, 0, 12,
			0, 1, 0, 20,
		]);
		const rows = disassembleBytecode(bytecode, {
			constantPool: Array.from({ length: 301 }, (_, index) => index),
			labels: { 65548: "caseA", 65556: "default" },
		});

		expect(rows[0].operands[0]).toMatchObject({
			type: "dispatch",
			cases: [
				{ constIndex: 300, value: 300, target: 65548, label: "caseA" },
			],
			defaultTarget: 65556,
			defaultLabel: "default",
		});
	});


	it("decodes inline closure operands", () => {
		const bytecode = new Uint8Array([
			Opcode.ALLOC_CLOSURE,
			0, 100,
			0, 32,
			2,
			0xff, 0xff,
		]);
		const rows = disassembleBytecode(bytecode);

		expect(rows[0].operands).toEqual([
			{ type: "offset", value: 100, label: undefined },
			{ type: "u16", name: "memorySize", value: 32 },
			{ type: "u8", name: "captureCount", value: 2 },
			{ type: "u16", name: "selfRefPtr", value: 65535 },
		]);
	});

	it("decodes wide inline closure operands", () => {
		const bytecode = new Uint8Array([
			Opcode.ALLOC_CLOSURE_W,
			0, 1, 0, 100,
			0, 2, 0, 32,
			2,
			0xff, 0xff, 0xff, 0xff,
		]);
		const rows = disassembleBytecode(bytecode);

		expect(rows[0].operands).toEqual([
			{ type: "offset", value: 65636, label: undefined },
			{ type: "u32", name: "memorySize", value: 131104 },
			{ type: "u8", name: "captureCount", value: 2 },
			{ type: "u32", name: "selfRefPtr", value: 4294967295 },
		]);
	});


	it("reports unknown and truncated bytecode without throwing", () => {
		const unknown = disassembleBytecode(new Uint8Array([0xff, Opcode.RET]));
		expect(unknown).toHaveLength(1);
		expect(unknown[0]).toMatchObject({ opcodeName: "UNKNOWN" });

		const truncated = disassembleBytecode(new Uint8Array([Opcode.JMP, 0]));
		expect(truncated).toHaveLength(1);
		expect(truncated[0]).toMatchObject({ opcodeName: "JMP", comment: "truncated operand" });
	});

	it("disassembles lowered return expressions", () => {
		const fn = getFirstFunction("function demo(a, b) { return a + b; }");
		const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
		const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
		const names = opcodeNames(lowered.bytecode, lowered.constantPool);

		expect(names).toEqual(expect.arrayContaining(["LOAD_ARGS", "GET_PROP", "ADD", "RET"]));
	});

	it("disassembles lowered branches and switches", () => {
		const branchFn = getFirstFunction("function demo(x) { if (x) { return 1; } return 2; }");
		const branchIr = translateFunctionToObfuscatedIR(branchFn, { seed: 1 });
		const branchLowered = lowerIRFunctionToBytecode(branchIr, { seed: 1 });
		expect(opcodeNames(branchLowered.bytecode, branchLowered.constantPool)).toContain("JMP_IF_W");

		const switchFn = getFirstFunction(
			"function demo(x) { switch (x) { case 1: return 10; default: return 20; } }",
		);
		const switchIr = translateFunctionToObfuscatedIR(switchFn, { seed: 1 });
		const switchLowered = lowerIRFunctionToBytecode(switchIr, { seed: 1 });
		expect(opcodeNames(switchLowered.bytecode, switchLowered.constantPool)).toContain("DISPATCH_W");
	});

	it("disassembles lowered program closures", () => {
		const ast = parser.parse(
			"var x = 1; var f = function () { return x; }; return f();",
			{ sourceType: "script", allowReturnOutsideFunction: true },
		);
		const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
		const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });

		expect(opcodeNames(lowered.bytecode, lowered.constantPool)).toContain("ALLOC_CLOSURE_W");
	});

	it("records function-level debug ranges that line up with disassembly rows", () => {
		const fn = getFirstFunction("function demo(a) { if (a) { return 1; } return 2; }");
		const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
		const lowered = lowerIRFunctionToBytecode(ir, { seed: 1, debug: true });
		const rows = disassembleBytecode(lowered.bytecode, { constantPool: lowered.constantPool });
		const rowOffsets = new Set(rows.map((row) => row.offset));

		expect(lowered.debugMap).toBeDefined();
		for (const [blockId, offset] of Object.entries(lowered.blockOffsets)) {
			const range = lowered.debugMap?.blockRanges.find((candidate) => candidate.blockId === blockId);
			expect(range?.startPc).toBe(offset);
		}
		for (const range of [
			...(lowered.debugMap?.instructionRanges ?? []),
			...(lowered.debugMap?.terminatorRanges ?? []),
		]) {
			expect(range.startPc).toBeLessThan(range.endPc);
			expect(range.endPc).toBeLessThanOrEqual(lowered.bytecode.length);
			expect(rowOffsets.has(range.startPc)).toBe(true);
		}
	});

	it("records program-level debug ranges with function ids", () => {
		const ast = parser.parse(
			"function f() { return 1; } return f();",
			{ sourceType: "script", allowReturnOutsideFunction: true },
		);
		const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
		const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1, debug: true });

		expect(lowered.debugMap?.blockRanges.length).toBeGreaterThan(0);
		expect(lowered.debugMap?.blockRanges.every((range) => range.funcId)).toBe(true);
		expect(lowered.debugMap?.instructionRanges.every((range) => range.funcId)).toBe(true);
		expect(lowered.debugMap?.terminatorRanges.every((range) => range.funcId)).toBe(true);
	});
});
