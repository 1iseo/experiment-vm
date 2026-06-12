import type {
	BasicBlock,
	BlockId,
	Dependency,
	IRFunction,
	Instruction,
	MoveInst,
	SsaId,
	VmPtr,
	IRProgram,
} from "./ir_v2.js";
import { Opcode } from "./vm.js";

export interface LoweringResult {
	bytecode: Uint8Array;
	constantPool: unknown[];
	ssaMemoryMap: Record<SsaId, VmPtr>;
	blockOffsets: Record<BlockId, number>;
	exceptionTable: ExceptionTableEntry[];
	memLayout: Record<string, VmPtr>;
	debugMap?: BytecodeDebugMap;
	captures?: string[];
	nested?: LoweringResult[];
}

export interface ProgramLoweringResult {
	bytecode: Uint8Array;
	constantPool: unknown[];
	entryPc: number;
	exceptionTable: ExceptionTableEntry[];
	debugMap?: BytecodeDebugMap;
}

export interface LoweringOptions {
	seed?: number;
	debug?: boolean;
	opcodeMap?: Record<number, number>;
}

export type ExceptionTableEntry = {
	startPc: number;
	endPc: number;
	handlerPc: number;
	errorPtr: number;
};

export type BytecodeDebugBlockRange = {
	funcId?: string;
	blockId: BlockId;
	startPc: number;
	endPc: number;
};

export type BytecodeDebugInstructionRange = {
	funcId?: string;
	blockId: BlockId;
	irId: SsaId;
	irType: Instruction["type"];
	startPc: number;
	endPc: number;
};

export type BytecodeDebugTerminatorRange = {
	funcId?: string;
	blockId: BlockId;
	termType: BasicBlock["term"]["type"];
	startPc: number;
	endPc: number;
};

export interface BytecodeDebugMap {
	blockRanges: BytecodeDebugBlockRange[];
	instructionRanges: BytecodeDebugInstructionRange[];
	terminatorRanges: BytecodeDebugTerminatorRange[];
}

type Backpatch = {
	offset: number;
	target: BlockId;
	width: 2 | 4;
};

const DEFAULT_META = { isJunk: false, pinned: false, cloneWeight: 0 };

function createSeededRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

function shuffleInPlace<T>(items: T[], rng: () => number): void {
	for (let i = items.length - 1; i > 0; i -= 1) {
		const j = Math.floor(rng() * (i + 1));
		const temp = items[i];
		items[i] = items[j];
		items[j] = temp;
	}
}

function cloneBlocks(fn: IRFunction): Map<BlockId, BasicBlock> {
	const blocks = new Map<BlockId, BasicBlock>();
	for (const [id, block] of fn.blocks.entries()) {
		blocks.set(id, {
			...block,
			insts: [...block.insts],
		});
	}
	return blocks;
}

function allocateSsaMemory(fn: IRFunction): { map: Record<SsaId, VmPtr>, size: number } {
	const map: Record<SsaId, VmPtr> = Object.create(null);
	const seen = new Set<SsaId>();
	let maxPtr = -1;
	for (const ptr of Object.values(fn.memLayout)) {
		if (ptr > maxPtr) {
			maxPtr = ptr;
		}
	}
	let nextPtr = maxPtr + 1;
	for (const block of fn.blocks.values()) {
		for (const inst of block.insts) {
			if (seen.has(inst.id)) {
				continue;
			}
			seen.add(inst.id);
			map[inst.id] = nextPtr;
			nextPtr += 1;
		}
	}
	return { map, size: nextPtr };
}

function destroyPhiNodes(blocks: Map<BlockId, BasicBlock>, rng: () => number): void {
	const blockIds = Array.from(blocks.keys());
	if (blockIds.length === 0) {
		return;
	}

	const injectedMoves = new Map<BlockId, MoveInst[]>();

	for (const block of blocks.values()) {
		const nextInsts: Instruction[] = [];
		for (const inst of block.insts) {
			if (inst.type !== "Phi") {
				nextInsts.push(inst);
				continue;
			}

			for (const choice of inst.choices) {
				const originId = choice.block === "ANY"
					? blockIds[Math.floor(rng() * blockIds.length)]
					: choice.block;
				const origin = blocks.get(originId);
				if (!origin) {
					throw new Error(`Phi lowering failed: block '${originId}' not found.`);
				}
				const moveInst: MoveInst = {
					id: inst.id,
					type: "Move",
					src: choice.val,
					deps: [],
					meta: DEFAULT_META,
				};
				const bucket = injectedMoves.get(originId) ?? [];
				bucket.push(moveInst);
				injectedMoves.set(originId, bucket);
			}
		}
		block.insts = nextInsts;
	}

	for (const [blockId, moves] of injectedMoves.entries()) {
		const targetBlock = blocks.get(blockId);
		if (!targetBlock) {
			continue;
		}
		targetBlock.insts.push(...moves);
	}
}

function getConstIndex(
	value: unknown,
	constantPool: unknown[],
	poolMap: Map<unknown, number>,
): number {
	const existing = poolMap.get(value);
	if (existing !== undefined) {
		return existing;
	}
	const index = constantPool.length;
	constantPool.push(value);
	poolMap.set(value, index);
	return index;
}

function switchCaseKeyToValue(key: string): unknown {
	if (key.startsWith("string:")) {
		return JSON.parse(key.slice("string:".length)) as string;
	}
	if (key.startsWith("number:")) {
		const raw = key.slice("number:".length);
		return raw === "-0" ? -0 : Number(raw);
	}
	if (key.startsWith("boolean:")) {
		return key.slice("boolean:".length) === "true";
	}
	if (key === "null") {
		return null;
	}
	if (key.startsWith("bigint:") && typeof BigInt === "function") {
		return BigInt(key.slice("bigint:".length));
	}
	return key;
}

export function lowerIRFunctionToBytecode(fn: IRFunction, options?: LoweringOptions): LoweringResult {
	const rng = options?.seed === undefined ? Math.random : createSeededRng(options.seed);
	const blocks = cloneBlocks(fn);
	const { map: ssaMemoryMap, size: memorySize } = allocateSsaMemory(fn);

	destroyPhiNodes(blocks, rng);

	const entry = blocks.get(fn.entry);
	if (!entry) {
		throw new Error(`Entry block '${fn.entry}' not found.`);
	}

	const otherBlocks = Array.from(blocks.values()).filter((block) => block.id !== fn.entry);
	shuffleInPlace(otherBlocks, rng);
	const orderedBlocks = [entry, ...otherBlocks];

	const constantPool: unknown[] = [];
	const poolMap = new Map<unknown, number>();
	const bytecode: number[] = [];
	const blockOffsets: Record<BlockId, number> = Object.create(null);
	const backpatches: Backpatch[] = [];
	const debugMap: BytecodeDebugMap | undefined = options?.debug
		? { blockRanges: [], instructionRanges: [], terminatorRanges: [] }
		: undefined;

	const emitU8 = (value: number) => {
		bytecode.push(value & 0xff);
	};

	const emitU16 = (value: number) => {
		emitU8((value >> 8) & 0xff);
		emitU8(value & 0xff);
	};

	const emitU32 = (value: number) => {
		emitU8(Math.floor(value / 0x1000000) & 0xff);
		emitU8((value >> 16) & 0xff);
		emitU8((value >> 8) & 0xff);
		emitU8(value & 0xff);
	};

	const emitOpcode = (opcode: Opcode) => {
		emitU8(options?.opcodeMap?.[opcode] ?? opcode);
	};

	const emitPushConstValue = (value: unknown) => {
		const index = getConstIndex(value, constantPool, poolMap);
		if (index > 0xffff) {
			throw new Error(`Constant pool index overflow: ${index}`);
		}
		if (index <= 0xff) {
			emitOpcode(Opcode.PUSH_CONST);
			emitU8(index);
		} else {
			emitOpcode(Opcode.PUSH_CONST_W);
			emitU16(index);
		}
	};

	const emitResolveGlobal = (name: string, ptr: VmPtr) => {
		emitPushConstValue(name);
		emitOpcode(Opcode.SYS_RESOLV);
		emitPushConstValue(ptr);
		emitOpcode(Opcode.STORE);
	};

	const emitLoadSsa = (id: SsaId) => {
		const ptr = ssaMemoryMap[id];
		if (ptr === undefined) {
			throw new Error(`Unknown SSA id '${id}' in lowering.`);
		}
		emitPushConstValue(ptr);
		emitOpcode(Opcode.LOAD);
	};

	const emitStoreSsa = (id: SsaId) => {
		const ptr = ssaMemoryMap[id];
		if (ptr === undefined) {
			throw new Error(`Unknown SSA id '${id}' in lowering.`);
		}
		emitPushConstValue(ptr);
		emitOpcode(Opcode.STORE);
	};

	const binOpMap: Record<string, Opcode> = {
		"+": Opcode.ADD,
		"-": Opcode.SUB,
		"*": Opcode.MUL,
		"/": Opcode.DIV,
		"%": Opcode.MOD,
		"^": Opcode.XOR,
		"&": Opcode.BIT_AND,
		"|": Opcode.BIT_OR,
		"<<": Opcode.SHL,
		">>": Opcode.SHR,
		">>>": Opcode.USHR,
		"===": Opcode.EQ,
		"!==": Opcode.NEQ,
		"==": Opcode.LOOSE_EQ,
		"!=": Opcode.LOOSE_NEQ,
		"<": Opcode.LT,
		"<=": Opcode.LTE,
		">": Opcode.GT,
		">=": Opcode.GTE,
		"in": Opcode.IN,
		"instanceof": Opcode.INSTANCEOF,
	};

	const unOpMap: Record<string, Opcode> = {
		"-": Opcode.NEG,
		"+": Opcode.POS,
		"!": Opcode.NOT,
		"~": Opcode.BIT_NOT,
		"typeof": Opcode.TYPEOF,
		"void": Opcode.VOID,
		"delete": Opcode.DELETE,
	};

	const emitFakeDependency = (dep: Dependency) => {
		emitLoadSsa(dep.id);
		emitOpcode(Opcode.POP);
	};

	for (const block of orderedBlocks) {
		blockOffsets[block.id] = bytecode.length;
		const blockStartPc = bytecode.length;

		if (block.id === fn.entry && fn.globals) {
			for (const [name, ptr] of Object.entries(fn.globals)) {
				emitResolveGlobal(name, ptr);
			}
		}

		for (const inst of block.insts) {
			const instStartPc = bytecode.length;
			for (const dep of inst.deps) {
				if (dep.type === "fake") {
					emitFakeDependency(dep);
				}
			}

			switch (inst.type) {
				case "Const": {
					emitPushConstValue(inst.value);
					emitStoreSsa(inst.id);
					break;
				}
				case "BinOp": {
					emitLoadSsa(inst.left);
					emitLoadSsa(inst.right);
					const opcode = binOpMap[inst.op];
					if (!opcode) {
						throw new Error(`Unsupported binary operator: ${inst.op}`);
					}
					emitOpcode(opcode);
					emitStoreSsa(inst.id);
					break;
				}
				case "UnOp": {
					emitLoadSsa(inst.arg);
					const opcode = unOpMap[inst.op];
					if (!opcode) {
						throw new Error(`Unsupported unary operator: ${inst.op}`);
					}
					emitOpcode(opcode);
					emitStoreSsa(inst.id);
					break;
				}
				case "Move": {
					emitLoadSsa(inst.src);
					emitStoreSsa(inst.id);
					break;
				}
				case "Load": {
					emitLoadSsa(inst.ptr);
					emitOpcode(Opcode.LOAD);
					emitStoreSsa(inst.id);
					break;
				}
				case "Store": {
					emitLoadSsa(inst.val);
					emitLoadSsa(inst.ptr);
					emitOpcode(Opcode.STORE);
					break;
				}
				case "Call": {
					emitLoadSsa(inst.callee);
					if (inst.thisArg) {
						emitLoadSsa(inst.thisArg);
					}
						for (const arg of inst.args) {
							emitLoadSsa(arg);
						}
						if (inst.directEval) {
							emitPushConstValue(inst.evalScope ?? {});
						}
						emitPushConstValue(inst.directEval ? inst.args.length + 1 : inst.args.length);
						emitOpcode(inst.directEval ? Opcode.CALL_EVAL : inst.thisArg ? Opcode.CALL_METHOD : Opcode.CALL);
						emitStoreSsa(inst.id);
						break;
					}
				case "New": {
					emitLoadSsa(inst.callee);
					for (const arg of inst.args) {
						emitLoadSsa(arg);
					}
					emitPushConstValue(inst.args.length);
					emitOpcode(Opcode.NEW);
					emitStoreSsa(inst.id);
					break;
				}
				case "GetProp": {
					emitLoadSsa(inst.obj);
					emitLoadSsa(inst.prop);
					emitOpcode(Opcode.GET_PROP);
					emitStoreSsa(inst.id);
					break;
				}
				case "SetProp": {
					emitLoadSsa(inst.obj);
					emitLoadSsa(inst.prop);
					emitLoadSsa(inst.val);
					emitOpcode(Opcode.SET_PROP);
					break;
				}
				case "AllocArray": {
					emitOpcode(Opcode.ALLOC_ARR);
					emitStoreSsa(inst.id);
					break;
				}
				case "AllocObject": {
					emitOpcode(Opcode.ALLOC_OBJ);
					emitStoreSsa(inst.id);
					break;
				}
				case "LoadArgs": {
					emitOpcode(Opcode.LOAD_ARGS);
					emitStoreSsa(inst.id);
					break;
				}
				case "Throw": {
					emitLoadSsa(inst.val);
					emitOpcode(Opcode.THROW);
					break;
				}
				case "Debugger": {
					emitPushConstValue(undefined);
					emitStoreSsa(inst.id);
					emitOpcode(Opcode.DEBUGGER);
					break;
				}
				case "Nop": {
					emitPushConstValue(undefined);
					emitStoreSsa(inst.id);
					break;
				}
				case "AllocClosure": {
					emitPushConstValue(inst.targetFunc);
					for (const capture of inst.captures) {
						emitLoadSsa(capture);
					}
					emitPushConstValue(inst.captures.length);
					emitOpcode(Opcode.ALLOC_CLOSURE);
					emitStoreSsa(inst.id);
					break;
				}
				case "LoadThis": {
					emitOpcode(Opcode.LOAD_THIS);
					emitStoreSsa(inst.id);
					break;
				}
				case "Phi": {
					throw new Error("Phi instruction remained after destruction pass.");
				}
				default: {
					const neverInst: never = inst;
					throw new Error(`Unsupported instruction: ${(neverInst as Instruction).type}`);
				}
			}
			debugMap?.instructionRanges.push({
				blockId: block.id,
				irId: inst.id,
				irType: inst.type,
				startPc: instStartPc,
				endPc: bytecode.length,
			});
		}

		const termStartPc = bytecode.length;
		const term = block.term;
		if (term.type === "Jmp") {
			emitOpcode(Opcode.JMP_W);
			backpatches.push({ offset: bytecode.length, target: term.target, width: 4 });
			emitU32(0xffffffff);
		} else if (term.type === "Br") {
			emitLoadSsa(term.cond);
			emitOpcode(Opcode.JMP_IF_W);
			backpatches.push({ offset: bytecode.length, target: term.trueTarget, width: 4 });
			emitU32(0xffffffff);
			emitOpcode(Opcode.JMP_W);
			backpatches.push({ offset: bytecode.length, target: term.falseTarget, width: 4 });
			emitU32(0xffffffff);
		} else if (term.type === "Switch") {
			emitLoadSsa(term.cond);
			const caseEntries = Object.entries(term.cases);
			if (caseEntries.length > 0xff) {
				throw new Error("SwitchTerm case count exceeds 255.");
			}
			const caseIndexes = caseEntries.map(([key, target]) => ({
				index: getConstIndex(switchCaseKeyToValue(key), constantPool, poolMap),
				target,
			}));
			emitOpcode(Opcode.DISPATCH_W);
			emitU8(caseEntries.length);
			for (const { index, target } of caseIndexes) {
				if (index > 0xffff) {
					throw new Error(`Constant pool index overflow: ${index}`);
				}
				emitU16(index);
				backpatches.push({ offset: bytecode.length, target, width: 4 });
				emitU32(0xffffffff);
			}
			backpatches.push({ offset: bytecode.length, target: term.defaultTarget, width: 4 });
			emitU32(0xffffffff);
		} else if (term.type === "Ret") {
			if (term.val !== null) {
				emitLoadSsa(term.val);
			} else {
				emitPushConstValue(undefined);
			}
			emitOpcode(Opcode.RET);
		}
		debugMap?.terminatorRanges.push({
			blockId: block.id,
			termType: term.type,
			startPc: termStartPc,
			endPc: bytecode.length,
		});
		debugMap?.blockRanges.push({
			blockId: block.id,
			startPc: blockStartPc,
			endPc: bytecode.length,
		});
	}

	for (const patch of backpatches) {
		const targetOffset = blockOffsets[patch.target];
		if (targetOffset === undefined) {
			throw new Error(`Backpatch target '${patch.target}' missing.`);
		}
		if (patch.width === 2) {
			if (targetOffset > 0xffff) {
				throw new Error(`Jump offset overflow: ${targetOffset}`);
			}
			bytecode[patch.offset] = (targetOffset >> 8) & 0xff;
			bytecode[patch.offset + 1] = targetOffset & 0xff;
		} else {
			bytecode[patch.offset] = Math.floor(targetOffset / 0x1000000) & 0xff;
			bytecode[patch.offset + 1] = (targetOffset >> 16) & 0xff;
			bytecode[patch.offset + 2] = (targetOffset >> 8) & 0xff;
			bytecode[patch.offset + 3] = targetOffset & 0xff;
		}
	}

	const handlerParamPtrs = new Map<BlockId, VmPtr>();
	for (const block of blocks.values()) {
		if (block.catchParamPtr !== undefined) {
			handlerParamPtrs.set(block.id, block.catchParamPtr);
		}
	}

	const exceptionTable: ExceptionTableEntry[] = [];
	for (let i = 0; i < orderedBlocks.length; i += 1) {
		const block = orderedBlocks[i];
		if (block.catchTarget === null) {
			continue;
		}
		const startPc = blockOffsets[block.id];
		const endPc = i + 1 < orderedBlocks.length
			? blockOffsets[orderedBlocks[i + 1].id]
			: bytecode.length;
		const handlerPc = blockOffsets[block.catchTarget];
		if (startPc === undefined || endPc === undefined || handlerPc === undefined) {
			throw new Error(`Exception table range missing for block '${block.id}'.`);
		}
		const errorPtr = handlerParamPtrs.get(block.catchTarget);
		if (errorPtr === undefined) {
			throw new Error(`Missing catch parameter pointer for handler '${block.catchTarget}'.`);
		}

		const last = exceptionTable[exceptionTable.length - 1];
		if (last && last.handlerPc === handlerPc && last.errorPtr === errorPtr && last.endPc === startPc) {
			last.endPc = endPc;
		} else {
			exceptionTable.push({
				startPc,
				endPc,
				handlerPc,
				errorPtr,
			});
		}
	}

	const nested = fn.nestedFunctions?.map((nestedFn) =>
		lowerIRFunctionToBytecode(nestedFn, {
			seed: Math.floor(rng() * 0x100000000),
			debug: options?.debug,
			opcodeMap: options?.opcodeMap,
		}),
	);


	return {
		bytecode: new Uint8Array(bytecode),
		constantPool,
		ssaMemoryMap,
		blockOffsets,
		exceptionTable,
		memLayout: fn.memLayout,
		debugMap,
		captures: fn.captures,
		nested: nested && nested.length > 0 ? nested : undefined,
	};
}

export function lowerIRProgramToBytecode(program: IRProgram, options?: LoweringOptions): ProgramLoweringResult {
	const rng = options?.seed === undefined ? Math.random : createSeededRng(options.seed);
	
	const functionMeta = new Map<string, { map: Record<SsaId, VmPtr>, size: number }>();
	for (const [funcId, fn] of program.functions.entries()) {
		functionMeta.set(funcId, allocateSsaMemory(fn));
	}

	const constantPool: unknown[] = [];
	const poolMap = new Map<unknown, number>();
	const bytecode: number[] = [];
	const globalBlockOffsets = new Map<string, number>();
	const backpatches: Array<{ offset: number, funcId: string, target: BlockId, width: 2 | 4 }> = [];
	const closureBackpatches: Array<{ offset: number, targetFunc: string, width: 2 | 4 }> = [];
	const exceptionTable: ExceptionTableEntry[] = [];
	const funcEntryOffsets = new Map<string, number>();
	const blockKey = (funcId: string, blockId: BlockId) => `${funcId}:${blockId}`;
	const debugMap: BytecodeDebugMap | undefined = options?.debug
		? { blockRanges: [], instructionRanges: [], terminatorRanges: [] }
		: undefined;

	const emitU8 = (value: number) => {
		bytecode.push(value & 0xff);
	};

	const emitU16 = (value: number) => {
		emitU8((value >> 8) & 0xff);
		emitU8(value & 0xff);
	};

	const emitU32 = (value: number) => {
		emitU8(Math.floor(value / 0x1000000) & 0xff);
		emitU8((value >> 16) & 0xff);
		emitU8((value >> 8) & 0xff);
		emitU8(value & 0xff);
	};

	const emitOpcode = (opcode: Opcode) => {
		emitU8(options?.opcodeMap?.[opcode] ?? opcode);
	};

	const getPoolIndex = (value: unknown): number => {
		const existing = poolMap.get(value);
		if (existing !== undefined) return existing;
		const index = constantPool.length;
		constantPool.push(value);
		poolMap.set(value, index);
		return index;
	};

	const emitPushConstValue = (value: unknown) => {
		const index = getPoolIndex(value);
		if (index > 0xffff) throw new Error(`Constant pool index overflow: ${index}`);
		if (index <= 0xff) {
			emitOpcode(Opcode.PUSH_CONST);
			emitU8(index);
		} else {
			emitOpcode(Opcode.PUSH_CONST_W);
			emitU16(index);
		}
	};

	const emitResolveGlobal = (name: string, ptr: VmPtr) => {
		emitPushConstValue(name);
		emitOpcode(Opcode.SYS_RESOLV);
		emitPushConstValue(ptr);
		emitOpcode(Opcode.STORE);
	};

	const binOpMap: Record<string, Opcode> = {
		"+": Opcode.ADD, "-": Opcode.SUB, "*": Opcode.MUL, "/": Opcode.DIV, "%": Opcode.MOD,
		"^": Opcode.XOR, "&": Opcode.BIT_AND, "|": Opcode.BIT_OR, "<<": Opcode.SHL,
		">>": Opcode.SHR, ">>>": Opcode.USHR, "===": Opcode.EQ, "!==": Opcode.NEQ,
		"==": Opcode.LOOSE_EQ, "!=": Opcode.LOOSE_NEQ, "<": Opcode.LT, "<=": Opcode.LTE,
		">": Opcode.GT, ">=": Opcode.GTE, "in": Opcode.IN, "instanceof": Opcode.INSTANCEOF,
	};

	const unOpMap: Record<string, Opcode> = {
		"-": Opcode.NEG, "+": Opcode.POS, "!": Opcode.NOT, "~": Opcode.BIT_NOT,
		"typeof": Opcode.TYPEOF, "void": Opcode.VOID, "delete": Opcode.DELETE,
	};

	const rawExceptionEntries: Array<{ startPc: number, endPc: number, funcId: string, catchTarget: BlockId, errorPtr: number }> = [];

	for (const [funcId, fn] of program.functions.entries()) {
		const meta = functionMeta.get(funcId)!;
		const ssaMemoryMap = meta.map;
		const blocks = cloneBlocks(fn);
		destroyPhiNodes(blocks, rng);

		const entry = blocks.get(fn.entry);
		if (!entry) throw new Error(`Entry block '${fn.entry}' not found.`);

		const otherBlocks = Array.from(blocks.values()).filter((block) => block.id !== fn.entry);
		shuffleInPlace(otherBlocks, rng);
		const orderedBlocks = [entry, ...otherBlocks];

		funcEntryOffsets.set(funcId, bytecode.length);

		const emitLoadSsa = (id: SsaId) => {
			const ptr = ssaMemoryMap[id];
			if (ptr === undefined) throw new Error(`Unknown SSA id '${id}'`);
			emitPushConstValue(ptr);
			emitOpcode(Opcode.LOAD);
		};

		const emitStoreSsa = (id: SsaId) => {
			const ptr = ssaMemoryMap[id];
			if (ptr === undefined) throw new Error(`Unknown SSA id '${id}'`);
			emitPushConstValue(ptr);
			emitOpcode(Opcode.STORE);
		};

		const emitFakeDependency = (dep: Dependency) => {
			emitLoadSsa(dep.id);
			emitOpcode(Opcode.POP);
		};

		const blockStartIndices: number[] = [];

		for (const block of orderedBlocks) {
			globalBlockOffsets.set(blockKey(funcId, block.id), bytecode.length);
			blockStartIndices.push(bytecode.length);
			const blockStartPc = bytecode.length;

			if (block.id === fn.entry) {
				for (const [name, ptr] of Object.entries(program.globals)) {
					emitResolveGlobal(name, ptr);
				}
			}

			for (const inst of block.insts) {
				const instStartPc = bytecode.length;
				for (const dep of inst.deps) {
					if (dep.type === "fake") emitFakeDependency(dep);
				}

				switch (inst.type) {
					case "Const": { emitPushConstValue(inst.value); emitStoreSsa(inst.id); break; }
					case "BinOp": {
						emitLoadSsa(inst.left); emitLoadSsa(inst.right);
						emitOpcode(binOpMap[inst.op]!); emitStoreSsa(inst.id); break;
					}
					case "UnOp": {
						emitLoadSsa(inst.arg); emitOpcode(unOpMap[inst.op]!);
						emitStoreSsa(inst.id); break;
					}
					case "Move": { emitLoadSsa(inst.src); emitStoreSsa(inst.id); break; }
					case "Load": { emitLoadSsa(inst.ptr); emitOpcode(Opcode.LOAD); emitStoreSsa(inst.id); break; }
					case "Store": { emitLoadSsa(inst.val); emitLoadSsa(inst.ptr); emitOpcode(Opcode.STORE); break; }
					case "Call": {
						emitLoadSsa(inst.callee);
						if (inst.thisArg) emitLoadSsa(inst.thisArg);
						for (const arg of inst.args) emitLoadSsa(arg);
						if (inst.directEval) emitPushConstValue(inst.evalScope ?? {});
						emitPushConstValue(inst.directEval ? inst.args.length + 1 : inst.args.length);
						emitOpcode(inst.directEval ? Opcode.CALL_EVAL : inst.thisArg ? Opcode.CALL_METHOD : Opcode.CALL);
						emitStoreSsa(inst.id);
						break;
					}
					case "New": {
						emitLoadSsa(inst.callee);
						for (const arg of inst.args) emitLoadSsa(arg);
						emitPushConstValue(inst.args.length);
						emitOpcode(Opcode.NEW);
						emitStoreSsa(inst.id);
						break;
					}
					case "GetProp": { emitLoadSsa(inst.obj); emitLoadSsa(inst.prop); emitOpcode(Opcode.GET_PROP); emitStoreSsa(inst.id); break; }
					case "SetProp": { emitLoadSsa(inst.obj); emitLoadSsa(inst.prop); emitLoadSsa(inst.val); emitOpcode(Opcode.SET_PROP); break; }
					case "AllocArray": { emitOpcode(Opcode.ALLOC_ARR); emitStoreSsa(inst.id); break; }
					case "AllocObject": { emitOpcode(Opcode.ALLOC_OBJ); emitStoreSsa(inst.id); break; }
					case "LoadArgs": { emitOpcode(Opcode.LOAD_ARGS); emitStoreSsa(inst.id); break; }
					case "Throw": { emitLoadSsa(inst.val); emitOpcode(Opcode.THROW); break; }
					case "Debugger": { emitPushConstValue(undefined); emitStoreSsa(inst.id); emitOpcode(Opcode.DEBUGGER); break; }
					case "Nop": { emitPushConstValue(undefined); emitStoreSsa(inst.id); break; }
					case "AllocClosure": {
						for (const capture of inst.captures) {
							emitLoadSsa(capture);
						}
						emitOpcode(Opcode.ALLOC_CLOSURE_W);
						closureBackpatches.push({ offset: bytecode.length, targetFunc: inst.targetFunc, width: 4 });
						emitU32(0xffffffff); // entryPc placeholder
						
						const targetMeta = functionMeta.get(inst.targetFunc);
						if (!targetMeta) throw new Error(`Unknown targetFunc '${inst.targetFunc}'`);
						if (targetMeta.size > 0xffffffff) throw new Error("Memory size overflow");
						
						emitU32(targetMeta.size);
						emitU8(inst.captures.length);
						
						const selfRefPtr = inst.selfRefPtr ?? 0xffffffff;
						if (selfRefPtr > 0xffffffff) throw new Error("Self-reference pointer overflow");
						emitU32(selfRefPtr);

						emitStoreSsa(inst.id);
						break;
					}
					case "LoadThis": {
						emitOpcode(Opcode.LOAD_THIS);
						emitStoreSsa(inst.id);
						break;
					}
					case "Phi": { throw new Error("Phi instruction remained after destruction pass."); }
					default: { throw new Error(`Unsupported instruction: ${(inst as Instruction).type}`); }
				}
				debugMap?.instructionRanges.push({
					funcId,
					blockId: block.id,
					irId: inst.id,
					irType: inst.type,
					startPc: instStartPc,
					endPc: bytecode.length,
				});
			}

			const termStartPc = bytecode.length;
			const term = block.term;
			if (term.type === "Jmp") {
				emitOpcode(Opcode.JMP_W);
				backpatches.push({ offset: bytecode.length, funcId, target: term.target, width: 4 });
				emitU32(0xffffffff);
			} else if (term.type === "Br") {
				emitLoadSsa(term.cond);
				emitOpcode(Opcode.JMP_IF_W);
				backpatches.push({ offset: bytecode.length, funcId, target: term.trueTarget, width: 4 });
				emitU32(0xffffffff);
				emitOpcode(Opcode.JMP_W);
				backpatches.push({ offset: bytecode.length, funcId, target: term.falseTarget, width: 4 });
				emitU32(0xffffffff);
			} else if (term.type === "Switch") {
				emitLoadSsa(term.cond);
				const caseEntries = Object.entries(term.cases);
				if (caseEntries.length > 0xff) throw new Error("SwitchTerm case count exceeds 255.");
				const caseIndexes = caseEntries.map(([key, target]) => ({
					index: getPoolIndex(switchCaseKeyToValue(key)),
					target,
				}));
				emitOpcode(Opcode.DISPATCH_W);
				emitU8(caseEntries.length);
				for (const { index, target } of caseIndexes) {
					if (index > 0xffff) throw new Error(`Constant pool index overflow: ${index}`);
					emitU16(index);
					backpatches.push({ offset: bytecode.length, funcId, target, width: 4 });
					emitU32(0xffffffff);
				}
				backpatches.push({ offset: bytecode.length, funcId, target: term.defaultTarget, width: 4 });
				emitU32(0xffffffff);
			} else if (term.type === "Ret") {
				if (term.val !== null) emitLoadSsa(term.val);
				else emitPushConstValue(undefined);
				emitOpcode(Opcode.RET);
			}
			debugMap?.terminatorRanges.push({
				funcId,
				blockId: block.id,
				termType: term.type,
				startPc: termStartPc,
				endPc: bytecode.length,
			});
			debugMap?.blockRanges.push({
				funcId,
				blockId: block.id,
				startPc: blockStartPc,
				endPc: bytecode.length,
			});
		}

		const handlerParamPtrs = new Map<BlockId, VmPtr>();
		for (const block of blocks.values()) {
			if (block.catchParamPtr !== undefined) handlerParamPtrs.set(block.id, block.catchParamPtr);
		}

		for (let i = 0; i < orderedBlocks.length; i += 1) {
			const block = orderedBlocks[i];
			if (block.catchTarget === null) continue;
			
			const startPc = blockStartIndices[i];
			const endPc = i + 1 < orderedBlocks.length ? blockStartIndices[i + 1] : bytecode.length;
			const errorPtr = handlerParamPtrs.get(block.catchTarget);
			
			if (startPc === undefined || endPc === undefined || errorPtr === undefined) {
				throw new Error(`Exception table range missing for block '${block.id}'.`);
			}

			rawExceptionEntries.push({ startPc, endPc, funcId, catchTarget: block.catchTarget, errorPtr });
		}
	}

	for (const raw of rawExceptionEntries) {
		const handlerPc = globalBlockOffsets.get(blockKey(raw.funcId, raw.catchTarget));
		if (handlerPc === undefined) throw new Error(`Handler pc missing for ${raw.catchTarget}`);
		
		const last = exceptionTable[exceptionTable.length - 1];
		if (last && last.handlerPc === handlerPc && last.errorPtr === raw.errorPtr && last.endPc === raw.startPc) {
			last.endPc = raw.endPc;
		} else {
			exceptionTable.push({
				startPc: raw.startPc,
				endPc: raw.endPc,
				handlerPc,
				errorPtr: raw.errorPtr,
			});
		}
	}

	for (const patch of backpatches) {
		const targetOffset = globalBlockOffsets.get(blockKey(patch.funcId, patch.target));
		if (targetOffset === undefined) throw new Error(`Backpatch target '${patch.target}' missing.`);
		if (patch.width === 2) {
			if (targetOffset > 0xffff) throw new Error(`Jump offset overflow: ${targetOffset}`);
			bytecode[patch.offset] = (targetOffset >> 8) & 0xff;
			bytecode[patch.offset + 1] = targetOffset & 0xff;
		} else {
			bytecode[patch.offset] = Math.floor(targetOffset / 0x1000000) & 0xff;
			bytecode[patch.offset + 1] = (targetOffset >> 16) & 0xff;
			bytecode[patch.offset + 2] = (targetOffset >> 8) & 0xff;
			bytecode[patch.offset + 3] = targetOffset & 0xff;
		}
	}

	for (const patch of closureBackpatches) {
		const targetOffset = funcEntryOffsets.get(patch.targetFunc);
		if (targetOffset === undefined) throw new Error(`Closure target '${patch.targetFunc}' missing.`);
		if (patch.width === 2) {
			if (targetOffset > 0xffff) throw new Error(`Closure offset overflow: ${targetOffset}`);
			bytecode[patch.offset] = (targetOffset >> 8) & 0xff;
			bytecode[patch.offset + 1] = targetOffset & 0xff;
		} else {
			bytecode[patch.offset] = Math.floor(targetOffset / 0x1000000) & 0xff;
			bytecode[patch.offset + 1] = (targetOffset >> 16) & 0xff;
			bytecode[patch.offset + 2] = (targetOffset >> 8) & 0xff;
			bytecode[patch.offset + 3] = targetOffset & 0xff;
		}
	}

	return {
		bytecode: new Uint8Array(bytecode),
		constantPool,
		entryPc: funcEntryOffsets.get(program.entryPoint) ?? 0,
		exceptionTable,
		debugMap,
	};
}
