import type { DisassembledInstruction } from "@experiment-vm/vm/disassemble";
import { previewValue } from "@experiment-vm/vm/disassemble";
import type { BytecodeDebugMap } from "@experiment-vm/vm/ir_lower";

export type DebugRangeKind = "block" | "instruction" | "terminator";

export type UiDebugRange = {
	id: string;
	kind: DebugRangeKind;
	funcId?: string;
	blockId: string;
	label: string;
	startPc: number;
	endPc: number;
	detail: string;
};

export function formatBytecodeHex(bytecode: Uint8Array, width = 16): string {
	const lines: string[] = [];
	for (let offset = 0; offset < bytecode.length; offset += width) {
		const chunk = Array.from(bytecode.slice(offset, offset + width));
		const bytes = chunk.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
		lines.push(`${offset.toString().padStart(4, "0")}: ${bytes}`);
	}
	return lines.join("\n");
}

export function formatConstantPool(constantPool: unknown[]): Array<{ index: number; preview: string }> {
	return constantPool.map((value, index) => ({
		index,
		preview: previewValue(value),
	}));
}

export function buildLabels(debugMap: BytecodeDebugMap | undefined): Record<number, string> {
	const labels: Record<number, string> = {};
	if (!debugMap) {
		return labels;
	}
	for (const range of debugMap.blockRanges) {
		const label = range.funcId ? `${range.funcId}:${range.blockId}` : range.blockId;
		labels[range.startPc] = label;
	}
	return labels;
}

export function flattenDebugRanges(debugMap: BytecodeDebugMap | undefined): UiDebugRange[] {
	if (!debugMap) {
		return [];
	}
	const ranges: UiDebugRange[] = [];
	for (const range of debugMap.blockRanges) {
		const funcPrefix = range.funcId ? `${range.funcId}:` : "";
		ranges.push({
			id: `block:${range.funcId ?? ""}:${range.blockId}:${range.startPc}`,
			kind: "block",
			funcId: range.funcId,
			blockId: range.blockId,
			label: `${funcPrefix}${range.blockId}`,
			startPc: range.startPc,
			endPc: range.endPc,
			detail: "block",
		});
	}
	for (const range of debugMap.instructionRanges) {
		const funcPrefix = range.funcId ? `${range.funcId}:` : "";
		ranges.push({
			id: `inst:${range.funcId ?? ""}:${range.irId}:${range.startPc}`,
			kind: "instruction",
			funcId: range.funcId,
			blockId: range.blockId,
			label: `${funcPrefix}${range.irId}`,
			startPc: range.startPc,
			endPc: range.endPc,
			detail: `${range.irType} in ${range.blockId}`,
		});
	}
	for (const range of debugMap.terminatorRanges) {
		const funcPrefix = range.funcId ? `${range.funcId}:` : "";
		ranges.push({
			id: `term:${range.funcId ?? ""}:${range.blockId}:${range.startPc}`,
			kind: "terminator",
			funcId: range.funcId,
			blockId: range.blockId,
			label: `${funcPrefix}${range.blockId}`,
			startPc: range.startPc,
			endPc: range.endPc,
			detail: `${range.termType} terminator`,
		});
	}
	const priority: Record<DebugRangeKind, number> = {
		block: 0,
		instruction: 1,
		terminator: 2,
	};
	return ranges.sort((a, b) =>
		a.startPc - b.startPc
		|| priority[a.kind] - priority[b.kind]
		|| a.endPc - b.endPc
	);
}

export function disassemblyOffsetsForRange(
	rows: DisassembledInstruction[],
	range: Pick<UiDebugRange, "startPc" | "endPc">,
): number[] {
	return rows
		.filter((row) => row.offset >= range.startPc && row.offset < range.endPc)
		.map((row) => row.offset);
}

export function bestDebugRangeForOffset(
	ranges: UiDebugRange[],
	offset: number,
): UiDebugRange | undefined {
	const containing = ranges.filter((range) => offset >= range.startPc && offset < range.endPc);
	if (containing.length === 0) {
		return undefined;
	}
	const priority: Record<DebugRangeKind, number> = {
		instruction: 0,
		terminator: 1,
		block: 2,
	};
	return containing.sort((a, b) =>
		priority[a.kind] - priority[b.kind]
		|| (a.endPc - a.startPc) - (b.endPc - b.startPc)
	)[0];
}
