import { Opcode } from "./vm.js";

export type DisassemblyOperand =
	| { type: "const"; index: number; value: unknown; hasValue: boolean }
	| { type: "offset"; value: number; label?: string }
	| { type: "u8"; name: string; value: number }
	| { type: "u16"; name: string; value: number }
	| { type: "u32"; name: string; value: number }
	| {
		type: "dispatch";
		cases: Array<{ constIndex: number; value?: unknown; target: number; label?: string }>;
		defaultTarget: number;
		defaultLabel?: string;
	};

export interface DisassembledInstruction {
	offset: number;
	opcode: number;
	opcodeName: string;
	operands: DisassemblyOperand[];
	size: number;
	bytes: number[];
	comment?: string;
}

export interface DisassembleOptions {
	constantPool?: unknown[];
	labels?: Record<number, string>;
	showBytes?: boolean;
}

export interface FormatDisassemblyOptions {
	showBytes?: boolean;
}

const opcodeNames = new Map<number, string>(
	Object.entries(Opcode)
		.filter(([, value]) => typeof value === "number")
		.map(([name, value]) => [value as number, name]),
);

function readU8(bytecode: Uint8Array, pc: number): number | undefined {
	return pc < bytecode.length ? bytecode[pc] : undefined;
}

function readU16(bytecode: Uint8Array, pc: number): number | undefined {
	const hi = readU8(bytecode, pc);
	const lo = readU8(bytecode, pc + 1);
	if (hi === undefined || lo === undefined) {
		return undefined;
	}
	return (hi << 8) | lo;
}

function readU32(bytecode: Uint8Array, pc: number): number | undefined {
	const b0 = readU8(bytecode, pc);
	const b1 = readU8(bytecode, pc + 1);
	const b2 = readU8(bytecode, pc + 2);
	const b3 = readU8(bytecode, pc + 3);
	if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
		return undefined;
	}
	return ((b0 * 0x1000000) + (b1 << 16) + (b2 << 8) + b3) >>> 0;
}

function bytesFor(bytecode: Uint8Array, start: number, end: number): number[] {
	return Array.from(bytecode.slice(start, Math.min(end, bytecode.length)));
}

function constantAt(pool: unknown[] | undefined, index: number): unknown {
	return pool && index < pool.length ? pool[index] : undefined;
}

function hasConstant(pool: unknown[] | undefined, index: number): boolean {
	return pool !== undefined && index < pool.length;
}

function labelFor(labels: Record<number, string> | undefined, offset: number): string | undefined {
	return labels?.[offset];
}

export function previewValue(value: unknown): string {
	if (value === undefined) {
		return "undefined";
	}
	if (typeof value === "function") {
		return `[function ${(value as Function).name || "anonymous"}]`;
	}
	if (typeof value === "symbol") {
		return value.toString();
	}
	if (typeof value === "bigint") {
		return `${value.toString()}n`;
	}
	if (value !== null && typeof value === "object") {
		try {
			const json = JSON.stringify(value);
			return json === undefined ? Object.prototype.toString.call(value) : json;
		} catch {
			return Object.prototype.toString.call(value);
		}
	}
	const json = JSON.stringify(value);
	return json === undefined ? String(value) : json;
}

function malformedRow(
	bytecode: Uint8Array,
	offset: number,
	opcode: number,
	opcodeName: string,
	expectedEnd: number,
	comment: string,
	operands: DisassemblyOperand[] = [],
): DisassembledInstruction {
	return {
		offset,
		opcode,
		opcodeName,
		operands,
		size: Math.max(1, bytecode.length - offset),
		bytes: bytesFor(bytecode, offset, expectedEnd),
		comment,
	};
}

function row(
	bytecode: Uint8Array,
	offset: number,
	opcode: number,
	opcodeName: string,
	end: number,
	operands: DisassemblyOperand[] = [],
	comment?: string,
): DisassembledInstruction {
	return {
		offset,
		opcode,
		opcodeName,
		operands,
		size: end - offset,
		bytes: bytesFor(bytecode, offset, end),
		comment,
	};
}

export function disassembleBytecode(
	bytecode: Uint8Array,
	options: DisassembleOptions = {},
): DisassembledInstruction[] {
	const rows: DisassembledInstruction[] = [];
	let pc = 0;

	while (pc < bytecode.length) {
		const offset = pc;
		const opcode = bytecode[pc++];
		const opcodeName = opcodeNames.get(opcode) ?? "UNKNOWN";

		if (opcodeName === "UNKNOWN") {
			rows.push(row(bytecode, offset, opcode, opcodeName, pc, [], `unknown opcode 0x${opcode.toString(16)}`));
			break;
		}

		if (opcode === Opcode.PUSH_CONST) {
			const index = readU8(bytecode, pc);
			if (index === undefined) {
				rows.push(malformedRow(bytecode, offset, opcode, opcodeName, offset + 2, "truncated operand"));
				break;
			}
			pc += 1;
			rows.push(row(bytecode, offset, opcode, opcodeName, pc, [
				{
					type: "const",
					index,
					value: constantAt(options.constantPool, index),
					hasValue: hasConstant(options.constantPool, index),
				},
			]));
			continue;
		}

		if (opcode === Opcode.PUSH_CONST_W) {
			const index = readU16(bytecode, pc);
			if (index === undefined) {
				rows.push(malformedRow(bytecode, offset, opcode, opcodeName, offset + 3, "truncated operand"));
				break;
			}
			pc += 2;
			rows.push(row(bytecode, offset, opcode, opcodeName, pc, [
				{
					type: "const",
					index,
					value: constantAt(options.constantPool, index),
					hasValue: hasConstant(options.constantPool, index),
				},
			]));
			continue;
		}

		if (opcode === Opcode.JMP || opcode === Opcode.JMP_IF) {
			const target = readU16(bytecode, pc);
			if (target === undefined) {
				rows.push(malformedRow(bytecode, offset, opcode, opcodeName, offset + 3, "truncated operand"));
				break;
			}
			pc += 2;
			rows.push(row(bytecode, offset, opcode, opcodeName, pc, [
				{ type: "offset", value: target, label: labelFor(options.labels, target) },
			]));
			continue;
		}

		if (opcode === Opcode.JMP_W || opcode === Opcode.JMP_IF_W) {
			const target = readU32(bytecode, pc);
			if (target === undefined) {
				rows.push(malformedRow(bytecode, offset, opcode, opcodeName, offset + 5, "truncated operand"));
				break;
			}
			pc += 4;
			rows.push(row(bytecode, offset, opcode, opcodeName, pc, [
				{ type: "offset", value: target, label: labelFor(options.labels, target) },
			]));
			continue;
		}

		if (opcode === Opcode.DISPATCH || opcode === Opcode.DISPATCH_W) {
			const caseCount = readU8(bytecode, pc);
			if (caseCount === undefined) {
				rows.push(malformedRow(bytecode, offset, opcode, opcodeName, offset + 2, "truncated operand"));
				break;
			}
			pc += 1;
			const cases: Array<{ constIndex: number; value?: unknown; target: number; label?: string }> = [];
			let truncated = false;
			for (let i = 0; i < caseCount; i += 1) {
				const wide = opcode === Opcode.DISPATCH_W;
				const constIndex = wide ? readU16(bytecode, pc) : readU8(bytecode, pc);
				const target = wide ? readU32(bytecode, pc + 2) : readU16(bytecode, pc + 1);
				if (constIndex === undefined || target === undefined) {
					truncated = true;
					break;
				}
				pc += wide ? 6 : 3;
				cases.push({
					constIndex,
					value: constantAt(options.constantPool, constIndex),
					target,
					label: labelFor(options.labels, target),
				});
			}
			const defaultTarget = truncated
				? undefined
				: opcode === Opcode.DISPATCH_W ? readU32(bytecode, pc) : readU16(bytecode, pc);
			if (truncated || defaultTarget === undefined) {
				rows.push(malformedRow(bytecode, offset, opcode, opcodeName, bytecode.length, "truncated operand", [
					{
						type: "dispatch",
						cases,
						defaultTarget: 0,
					},
				]));
				break;
			}
			pc += opcode === Opcode.DISPATCH_W ? 4 : 2;
			rows.push(row(bytecode, offset, opcode, opcodeName, pc, [
				{
					type: "dispatch",
					cases,
					defaultTarget,
					defaultLabel: labelFor(options.labels, defaultTarget),
				},
			]));
			continue;
		}

		if (opcode === Opcode.ALLOC_CLOSURE || opcode === Opcode.ALLOC_CLOSURE_W) {
			const wide = opcode === Opcode.ALLOC_CLOSURE_W;
			const entryPc = wide ? readU32(bytecode, pc) : readU16(bytecode, pc);
			const memorySize = wide ? readU32(bytecode, pc + 4) : readU16(bytecode, pc + 2);
			const captureCount = readU8(bytecode, pc + (wide ? 8 : 4));
			const selfRefPtr = wide ? readU32(bytecode, pc + 9) : readU16(bytecode, pc + 5);
			if (
				entryPc === undefined
				|| memorySize === undefined
				|| captureCount === undefined
				|| selfRefPtr === undefined
			) {
				rows.push(malformedRow(bytecode, offset, opcode, opcodeName, offset + (wide ? 14 : 8), "truncated operand"));
				break;
			}
			pc += wide ? 13 : 7;
			rows.push(row(bytecode, offset, opcode, opcodeName, pc, [
				{ type: "offset", value: entryPc, label: labelFor(options.labels, entryPc) },
				{ type: wide ? "u32" : "u16", name: "memorySize", value: memorySize },
				{ type: "u8", name: "captureCount", value: captureCount },
				{ type: wide ? "u32" : "u16", name: "selfRefPtr", value: selfRefPtr },
			]));
			continue;
		}

		rows.push(row(bytecode, offset, opcode, opcodeName, pc));
	}

	return rows;
}

function formatOffset(offset: number): string {
	return offset.toString().padStart(4, "0");
}

function formatBytes(bytes: number[]): string {
	return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

function formatOperand(operand: DisassemblyOperand): string {
	switch (operand.type) {
		case "const": {
			const value = operand.hasValue ? ` ; ${previewValue(operand.value)}` : "";
			return `#${operand.index}${value}`;
		}
		case "offset":
			return operand.label ? `${operand.label}(${formatOffset(operand.value)})` : formatOffset(operand.value);
		case "u8":
		case "u16":
		case "u32":
			return `${operand.name}=${operand.value}`;
		case "dispatch": {
			const cases = operand.cases.map((entry) => {
				const key = entry.value === undefined ? `#${entry.constIndex}` : previewValue(entry.value);
				const target = entry.label ? `${entry.label}(${formatOffset(entry.target)})` : formatOffset(entry.target);
				return `${key}:${target}`;
			});
			const defaultTarget = operand.defaultLabel
				? `${operand.defaultLabel}(${formatOffset(operand.defaultTarget)})`
				: formatOffset(operand.defaultTarget);
			return `{ ${cases.join(", ")} default:${defaultTarget} }`;
		}
	}
}

export function formatDisassembly(
	rows: DisassembledInstruction[],
	options: FormatDisassemblyOptions = {},
): string {
	return rows.map((inst) => {
		const operands = inst.operands.map(formatOperand).join(", ");
		const byteColumn = options.showBytes ? ` ${formatBytes(inst.bytes).padEnd(23, " ")}` : "";
		const comment = inst.comment ? ` ; ${inst.comment}` : "";
		return `${formatOffset(inst.offset)}${byteColumn} ${inst.opcodeName}${operands ? ` ${operands}` : ""}${comment}`;
	}).join("\n");
}
