import * as t from "@babel/types";
import { z } from "zod";

export type SsaId = string; // "v_0x1a4"
export type BlockId = string; // b_0x00"
export type VmPtr = number; // Virtual memory address/slot

export interface ObfuscationMeta {
  isJunk: boolean;
  opaqueTag?: string;
  pinned: boolean;
  cloneWeight: number;
}

export type DepType = "real" | "fake" | "ghost";

export interface Dependency {
  id: SsaId;
  type: DepType;
}

// Base Instruction
export interface BaseInst {
  id: SsaId;
  deps: Dependency[]; // Explicit dependency graph independent of arguments
  meta: ObfuscationMeta;
}

// Instruction Set
export interface ConstInst extends BaseInst {
  type: "Const";
  value: any;
}
export interface BinOpInst extends BaseInst {
  type: "BinOp";
  op: string;
  left: SsaId;
  right: SsaId;
}
export interface UnOpInst extends BaseInst {
  type: "UnOp";
  op: string;
  arg: SsaId;
}
export interface MoveInst extends BaseInst {
  type: "Move";
  src: SsaId;
}
export interface LoadInst extends BaseInst {
  type: "Load";
  ptr: SsaId;
}
export interface StoreInst extends BaseInst {
  type: "Store";
  ptr: SsaId;
  val: SsaId;
}
export interface CallInst extends BaseInst {
  type: "Call";
  callee: SsaId;
  args: SsaId[];
  thisArg?: SsaId;
  directEval?: boolean;
  evalScope?: Record<string, VmPtr>;
}
export interface NewInst extends BaseInst {
  type: "New";
  callee: SsaId;
  args: SsaId[];
}
export interface GetPropInst extends BaseInst {
  type: "GetProp";
  obj: SsaId;
  prop: SsaId;
}
export interface SetPropInst extends BaseInst {
  type: "SetProp";
  obj: SsaId;
  prop: SsaId;
  val: SsaId;
}
export interface AllocArrayInst extends BaseInst {
  type: "AllocArray";
}
export interface AllocObjectInst extends BaseInst {
  type: "AllocObject";
}
export interface LoadArgsInst extends BaseInst {
  type: "LoadArgs";
}
export interface ThrowInst extends BaseInst {
  type: "Throw";
  val: SsaId;
}
export interface DebuggerInst extends BaseInst {
  type: "Debugger";
}
export interface NopInst extends BaseInst {
  type: "Nop";
}
export interface AllocClosureInst extends BaseInst {
  type: "AllocClosure";
  targetFunc: string;
  captures: SsaId[];
  selfRefPtr?: number;
}
export interface LoadThisInst extends BaseInst {
  type: "LoadThis";
}

export interface PhiChoice {
  block: BlockId | "ANY"; // 'ANY' breaks CFG-dominance reliance
  val: SsaId;
}
export interface PhiInst extends BaseInst {
  type: "Phi";
  choices: PhiChoice[];
}

export type Instruction =
  | ConstInst
  | BinOpInst
  | UnOpInst
  | MoveInst
  | LoadInst
  | StoreInst
  | CallInst
  | NewInst
  | PhiInst
  | GetPropInst
  | SetPropInst
  | AllocArrayInst
  | AllocObjectInst
  | LoadArgsInst
  | ThrowInst
  | DebuggerInst
  | NopInst
  | AllocClosureInst
  | LoadThisInst;

// Terminators
export interface BaseTerm {
  meta: ObfuscationMeta;
}
export interface JmpTerm extends BaseTerm {
  type: "Jmp";
  target: BlockId;
}
export interface BrTerm extends BaseTerm {
  type: "Br";
  cond: SsaId;
  trueTarget: BlockId;
  falseTarget: BlockId;
}
export interface SwitchTerm extends BaseTerm {
  type: "Switch";
  cond: SsaId;
  cases: Record<string, BlockId>;
  defaultTarget: BlockId;
}
export interface RetTerm extends BaseTerm {
  type: "Ret";
  val: SsaId | null;
}

export type Terminator = JmpTerm | BrTerm | SwitchTerm | RetTerm;

// Block & Structure
export interface BasicBlock {
  id: BlockId;
  insts: Instruction[];
  term: Terminator;
  meta: ObfuscationMeta;
  catchTarget: BlockId | null;
  catchParamPtr?: VmPtr;
}

export interface IRFunction {
  id: string;
  params: SsaId[];
  blocks: Map<BlockId, BasicBlock>;
  entry: BlockId;
  memLayout: Record<string, VmPtr>; // Maps original variables to VM memory layout
  globals?: Record<string, VmPtr>; // Optional global environment mapping
  nestedFunctions?: IRFunction[]; // Nested function literals (getters/setters, etc.)
  captures?: string[]; // Captured names for closure entry setup
  selfRefPtr?: number; // VmPtr for NFE self-reference
}

export interface IRProgram {
  functions: Map<string, IRFunction>;
  globals: Record<string, VmPtr>;
  entryPoint: string;
}

export const SsaIdSchema = z.string();
export const BlockIdSchema = z.string();
export const VmPtrSchema = z.number();
export const DepTypeSchema = z.enum(["real", "fake", "ghost"]);

export const DependencySchema = z.object({
  id: SsaIdSchema,
  type: DepTypeSchema,
});

export const ObfuscationMetaSchema = z.object({
  isJunk: z.boolean(),
  opaqueTag: z.string().optional(),
  pinned: z.boolean(),
  cloneWeight: z.number(),
});

const BaseInstSchema = z.object({
  id: SsaIdSchema,
  deps: z.array(DependencySchema),
  meta: ObfuscationMetaSchema,
});

const ConstInstSchema = BaseInstSchema.extend({
  type: z.literal("Const"),
  value: z.unknown(),
});

const BinOpInstSchema = BaseInstSchema.extend({
  type: z.literal("BinOp"),
  op: z.string(),
  left: SsaIdSchema,
  right: SsaIdSchema,
});

const UnOpInstSchema = BaseInstSchema.extend({
  type: z.literal("UnOp"),
  op: z.string(),
  arg: SsaIdSchema,
});

const MoveInstSchema = BaseInstSchema.extend({
  type: z.literal("Move"),
  src: SsaIdSchema,
});

const LoadInstSchema = BaseInstSchema.extend({
  type: z.literal("Load"),
  ptr: SsaIdSchema,
});

const StoreInstSchema = BaseInstSchema.extend({
  type: z.literal("Store"),
  ptr: SsaIdSchema,
  val: SsaIdSchema,
});

const CallInstSchema = BaseInstSchema.extend({
  type: z.literal("Call"),
  callee: SsaIdSchema,
  args: z.array(SsaIdSchema),
  thisArg: SsaIdSchema.optional(),
  directEval: z.boolean().optional(),
  evalScope: z.record(z.string(), VmPtrSchema).optional(),
});

const NewInstSchema = BaseInstSchema.extend({
  type: z.literal("New"),
  callee: SsaIdSchema,
  args: z.array(SsaIdSchema),
});

const GetPropInstSchema = BaseInstSchema.extend({
  type: z.literal("GetProp"),
  obj: SsaIdSchema,
  prop: SsaIdSchema,
});

const SetPropInstSchema = BaseInstSchema.extend({
  type: z.literal("SetProp"),
  obj: SsaIdSchema,
  prop: SsaIdSchema,
  val: SsaIdSchema,
});

const AllocArrayInstSchema = BaseInstSchema.extend({
  type: z.literal("AllocArray"),
});

const AllocObjectInstSchema = BaseInstSchema.extend({
  type: z.literal("AllocObject"),
});

const LoadArgsInstSchema = BaseInstSchema.extend({
  type: z.literal("LoadArgs"),
});

const ThrowInstSchema = BaseInstSchema.extend({
  type: z.literal("Throw"),
  val: SsaIdSchema,
});

const DebuggerInstSchema = BaseInstSchema.extend({
  type: z.literal("Debugger"),
});

const NopInstSchema = BaseInstSchema.extend({
  type: z.literal("Nop"),
});

const AllocClosureInstSchema = BaseInstSchema.extend({
  type: z.literal("AllocClosure"),
  targetFunc: z.string(),
  captures: z.array(SsaIdSchema),
  selfRefPtr: z.number().optional(),
});

const LoadThisInstSchema = BaseInstSchema.extend({
  type: z.literal("LoadThis"),
});

const PhiChoiceSchema = z.object({
  block: z.union([BlockIdSchema, z.literal("ANY")]),
  val: SsaIdSchema,
});

const PhiInstSchema = BaseInstSchema.extend({
  type: z.literal("Phi"),
  choices: z.array(PhiChoiceSchema),
});

export const InstructionSchema = z.discriminatedUnion("type", [
  ConstInstSchema,
  BinOpInstSchema,
  UnOpInstSchema,
  MoveInstSchema,
  LoadInstSchema,
  StoreInstSchema,
  CallInstSchema,
  NewInstSchema,
  GetPropInstSchema,
  SetPropInstSchema,
  AllocArrayInstSchema,
  AllocObjectInstSchema,
  LoadArgsInstSchema,
  ThrowInstSchema,
  DebuggerInstSchema,
  NopInstSchema,
  AllocClosureInstSchema,
  LoadThisInstSchema,
  PhiInstSchema,
]);

const BaseTermSchema = z.object({
  meta: ObfuscationMetaSchema,
});

const JmpTermSchema = BaseTermSchema.extend({
  type: z.literal("Jmp"),
  target: BlockIdSchema,
});

const BrTermSchema = BaseTermSchema.extend({
  type: z.literal("Br"),
  cond: SsaIdSchema,
  trueTarget: BlockIdSchema,
  falseTarget: BlockIdSchema,
});

const SwitchTermSchema = BaseTermSchema.extend({
  type: z.literal("Switch"),
  cond: SsaIdSchema,
  cases: z.record(z.string(), BlockIdSchema),
  defaultTarget: BlockIdSchema,
});

const RetTermSchema = BaseTermSchema.extend({
  type: z.literal("Ret"),
  val: z.union([SsaIdSchema, z.null()]),
});

export const TerminatorSchema = z.discriminatedUnion("type", [
  JmpTermSchema,
  BrTermSchema,
  SwitchTermSchema,
  RetTermSchema,
]);

export const BasicBlockSchema = z.object({
  id: BlockIdSchema,
  insts: z.array(InstructionSchema),
  term: TerminatorSchema,
  meta: ObfuscationMetaSchema,
  catchTarget: z.union([BlockIdSchema, z.null()]),
  catchParamPtr: VmPtrSchema.optional(),
});

type BasicBlockSchemaType = z.infer<typeof BasicBlockSchema>;
type BasicBlockRecord = Record<string, BasicBlockSchemaType>;

const BlocksSchema = z.preprocess(
  (value: unknown) =>
    value instanceof Map ? Object.fromEntries(value) : value,
  z
    .record(BlockIdSchema, BasicBlockSchema)
    .transform((blocks: BasicBlockRecord) => new Map(Object.entries(blocks))),
);

export const IRFunctionSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    id: z.string(),
    params: z.array(SsaIdSchema),
    blocks: BlocksSchema,
    entry: BlockIdSchema,
    memLayout: z.record(z.string(), VmPtrSchema),
    globals: z.record(z.string(), VmPtrSchema).optional(),
    nestedFunctions: z.array(IRFunctionSchema).optional(),
    captures: z.array(z.string()).optional(),
    selfRefPtr: z.number().optional(),
  }),
);

type IRFunctionSchemaType = z.infer<typeof IRFunctionSchema>;
type FunctionRecord = Record<string, IRFunctionSchemaType>;

const FunctionsSchema = z.preprocess(
  (value: unknown) =>
    value instanceof Map ? Object.fromEntries(value) : value,
  z
    .record(z.string(), IRFunctionSchema)
    .transform((funcs: FunctionRecord) => new Map(Object.entries(funcs))),
);

export const IRProgramSchema = z.object({
  functions: FunctionsSchema,
  globals: z.record(z.string(), VmPtrSchema),
  entryPoint: z.string(),
});

export function validateSchema(rawJson: unknown): IRProgram {
  return IRProgramSchema.parse(rawJson) as IRProgram;
}

export class IrInvariantChecker {
  public static check(program: IRProgram): void {
    for (const [funcName, func] of program.functions.entries()) {
      this.checkFunction(funcName, func);
    }
  }

  private static checkFunction(funcName: string, func: IRFunction): void {
    const definedBlocks = new Set<BlockId>(func.blocks.keys());
    const definedSsaIds = new Set<SsaId>(func.params);

    for (const block of func.blocks.values()) {
      for (const inst of block.insts) {
        if (definedSsaIds.has(inst.id)) {
          throw new Error(
            `[${funcName}] SSA Violation: ID '${inst.id}' is defined multiple times.`,
          );
        }
        definedSsaIds.add(inst.id);
      }
    }

    if (!definedBlocks.has(func.entry)) {
      throw new Error(
        `[${funcName}] CFG Violation: Entry block '${func.entry}' does not exist.`,
      );
    }

    for (const block of func.blocks.values()) {
      if (block.catchTarget !== null && !definedBlocks.has(block.catchTarget)) {
        throw new Error(
          `[${funcName}] CFG Violation: Catch target '${block.catchTarget}' in '${block.id}' missing.`,
        );
      }
      for (const inst of block.insts) {
        for (const dep of inst.deps) {
          if (!definedSsaIds.has(dep.id)) {
            throw new Error(
              `[${funcName}] Dep Violation: Instruction '${inst.id}' references undefined ID '${dep.id}'.`,
            );
          }
        }

        if (inst.type === "Phi") {
          for (const choice of inst.choices) {
            if (choice.block !== "ANY" && !definedBlocks.has(choice.block)) {
              throw new Error(
                `[${funcName}] Phi Violation: Choice block '${choice.block}' does not exist.`,
              );
            }
          }
        }
      }

      const term = block.term;
      if (term.type === "Jmp") {
        if (!definedBlocks.has(term.target)) {
          throw new Error(
            `[${funcName}] CFG Violation: Jmp target '${term.target}' in '${block.id}' missing.`,
          );
        }
      } else if (term.type === "Br") {
        if (!definedSsaIds.has(term.cond)) {
          throw new Error(
            `[${funcName}] CFG Violation: Br condition '${term.cond}' undefined.`,
          );
        }
        if (
          !definedBlocks.has(term.trueTarget) ||
          !definedBlocks.has(term.falseTarget)
        ) {
          throw new Error(
            `[${funcName}] CFG Violation: Br targets in '${block.id}' are invalid.`,
          );
        }
      } else if (term.type === "Switch") {
        if (!definedSsaIds.has(term.cond)) {
          throw new Error(
            `[${funcName}] CFG Violation: Switch condition '${term.cond}' undefined.`,
          );
        }
        if (!definedBlocks.has(term.defaultTarget)) {
          throw new Error(
            `[${funcName}] CFG Violation: Switch default target '${term.defaultTarget}' missing.`,
          );
        }
        for (const [key, target] of Object.entries(term.cases)) {
          if (!definedBlocks.has(target)) {
            throw new Error(
              `[${funcName}] CFG Violation: Switch case '${key}' target '${target}' missing.`,
            );
          }
        }
      } else if (term.type === "Ret") {
        if (term.val !== null && !definedSsaIds.has(term.val)) {
          throw new Error(
            `[${funcName}] CFG Violation: Ret value '${term.val}' undefined.`,
          );
        }
      }
    }
  }
}

type InstFormatter = (inst: Instruction) => string;
type TermFormatter = (term: Terminator) => string;

const instFormatters: Record<Instruction["type"], InstFormatter> = {
  Const: (inst) =>
    `${inst.id} = const ${formatLiteral((inst as ConstInst).value)}`,
  BinOp: (inst) => {
    const bin = inst as BinOpInst;
    return `${bin.id} = binop ${bin.op} ${bin.left}, ${bin.right}`;
  },
  UnOp: (inst) => {
    const un = inst as UnOpInst;
    return `${un.id} = unop ${un.op} ${un.arg}`;
  },
  Move: (inst) => {
    const move = inst as MoveInst;
    return `${move.id} = move ${move.src}`;
  },
  Load: (inst) => {
    const load = inst as LoadInst;
    return `${load.id} = load ${load.ptr}`;
  },
  Store: (inst) => {
    const store = inst as StoreInst;
    return `${store.id} = store ${store.ptr}, ${store.val}`;
  },
  Call: (inst) => {
    const call = inst as CallInst;
    const receiver = call.thisArg ? `${call.thisArg}.` : "";
    return `${call.id} = call ${call.directEval ? "direct-eval " : ""}${receiver}${call.callee}(${call.args.join(", ")})`;
  },
  New: (inst) => {
    const newInst = inst as NewInst;
    return `${newInst.id} = new ${newInst.callee}(${newInst.args.join(", ")})`;
  },
  GetProp: (inst) => {
    const getProp = inst as GetPropInst;
    return `${getProp.id} = getprop ${getProp.obj}, ${getProp.prop}`;
  },
  SetProp: (inst) => {
    const setProp = inst as SetPropInst;
    return `${setProp.id} = setprop ${setProp.obj}, ${setProp.prop}, ${setProp.val}`;
  },
  AllocArray: (inst) => {
    return `${inst.id} = allocarray`;
  },
  AllocObject: (inst) => {
    return `${inst.id} = allocobject`;
  },
  LoadArgs: (inst) => {
    return `${inst.id} = loadargs`;
  },
  Throw: (inst) => {
    const thr = inst as ThrowInst;
    return `${thr.id} = throw ${thr.val}`;
  },
  Debugger: (inst) => {
    return `${inst.id} = debugger`;
  },
  Nop: (inst) => {
    return `${inst.id} = nop`;
  },
  AllocClosure: (inst) => {
    const closure = inst as AllocClosureInst;
    return `${closure.id} = allocclosure ${closure.targetFunc} [${closure.captures.join(", ")}]${closure.selfRefPtr !== undefined ? ` self=${closure.selfRefPtr}` : ""}`;
  },
  LoadThis: (inst) => {
    return `${inst.id} = loadthis`;
  },
  Phi: (inst) => {
    const phi = inst as PhiInst;
    const choices = phi.choices
      .map((choice) => `${choice.block}:${choice.val}`)
      .join(", ");
    return `${phi.id} = phi [${choices}]`;
  },
};

const termFormatters: Record<Terminator["type"], TermFormatter> = {
  Jmp: (term) => `jmp ${(term as JmpTerm).target}`,
  Br: (term) => {
    const br = term as BrTerm;
    return `br ${br.cond} ? ${br.trueTarget} : ${br.falseTarget}`;
  },
  Switch: (term) => {
    const sw = term as SwitchTerm;
    const cases = Object.entries(sw.cases)
      .map(([value, target]) => `${formatLiteral(value)} -> ${target}`)
      .join(", ");
    return `switch ${sw.cond} { ${cases} default -> ${sw.defaultTarget} }`;
  },
  Ret: (term) => {
    const ret = term as RetTerm;
    return ret.val ? `ret ${ret.val}` : "ret";
  },
};

function formatLiteral(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === undefined) {
    return "undefined";
  }
  const json = JSON.stringify(value);
  return json ?? String(value);
}

function formatDeps(deps: Dependency[]): string {
  if (deps.length === 0) {
    return "";
  }
  const rendered = deps.map((dep) => `${dep.type}:${dep.id}`).join(", ");
  return ` deps[${rendered}]`;
}

export function prettyPrintIRFunction(fn: IRFunction): string {
  const lines: string[] = [];

  lines.push(`function ${fn.id}(${fn.params.join(", ")}) {`);
  lines.push(`  entry: ${fn.entry}`);
  lines.push(`  memLayout: ${JSON.stringify(fn.memLayout)}`);
  if (fn.globals && Object.keys(fn.globals).length > 0) {
    lines.push(`  globals: ${JSON.stringify(fn.globals)}`);
  }
  lines.push("  blocks:");

  for (const block of fn.blocks.values()) {
    lines.push(`    ${block.id}:`);
    if (block.catchTarget !== null) {
      lines.push(`      catch: ${block.catchTarget}`);
    }
    if (block.catchParamPtr !== undefined) {
      lines.push(`      catchParamPtr: ${block.catchParamPtr}`);
    }
    for (const inst of block.insts) {
      const formatter = instFormatters[inst.type];
      const rendered = formatter ? formatter(inst) : `${inst.id} = <unknown>`;
      lines.push(`      ${rendered}${formatDeps(inst.deps)}`);
    }
    const termFormatter = termFormatters[block.term.type];
    const termRendered = termFormatter
      ? termFormatter(block.term)
      : "<unknown>";
    lines.push(`      term: ${termRendered}`);
  }

  lines.push("}");
  return lines.join("\n");
}

export interface IRBuilderState {
  memLayout: Map<string, VmPtr>;
  globals: Map<string, VmPtr>;
  blocks: Map<BlockId, BasicBlock>;
  currentBlock: BasicBlock;
  rng: () => number;
  nestedFunctions: IRFunction[];
  functionBindings: Set<string>;
  functionId: string;
  ssaCounter: number;
  functionCounter: number;
  nextBlockId: number;
  nextPtr: VmPtr;
  globalBase: VmPtr;
  globalStride: VmPtr;
  terminatedBlocks: Set<BlockId>;
  breakStack: BlockId[];
  continueStack: BlockId[];
  activeCatchStack: BlockId[];
  labelStack: Array<{
    name: string;
    breakTarget: BlockId;
    continueTarget?: BlockId;
  }>;
  finallyStack: t.BlockStatement[];
  flattenCfg: boolean;
}

const DEFAULT_GLOBAL_BASE: VmPtr = 0x8000;
const DEFAULT_GLOBAL_STRIDE: VmPtr = 4;

function createMeta(): ObfuscationMeta {
  return {
    isJunk: false,
    pinned: false,
    cloneWeight: 0,
  };
}

function createBlock(
  state: IRBuilderState,
  id?: BlockId,
  catchTarget?: BlockId | null,
): BasicBlock {
  const blockId = id ?? `b_${state.nextBlockId++}`;
  const activeCatch =
    state.activeCatchStack[state.activeCatchStack.length - 1] ?? null;
  const block: BasicBlock = {
    id: blockId,
    insts: [],
    term: {
      type: "Ret",
      val: null,
      meta: createMeta(),
    },
    meta: createMeta(),
    catchTarget: catchTarget ?? activeCatch,
  };

  state.blocks.set(blockId, block);
  return block;
}

function allocateBlockId(state: IRBuilderState, prefix: string): BlockId {
  const id = `${prefix}${state.nextBlockId}`;
  state.nextBlockId += 1;
  return id;
}

function newSsaId(state: IRBuilderState): SsaId {
  const id = `v_${state.ssaCounter}`;
  state.ssaCounter += 1;
  return id;
}

function newFunctionId(state: IRBuilderState, prefix: string): string {
  const id = `${prefix}${state.functionCounter}`;
  state.functionCounter += 1;
  return id;
}

function allocPtr(state: IRBuilderState): VmPtr {
  const ptr = state.nextPtr;
  state.nextPtr += 4;
  return ptr;
}

function emitInst(state: IRBuilderState, inst: Instruction): SsaId {
  state.currentBlock.insts.push(inst);
  return inst.id;
}

function shuffleInPlace<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }
}

function lowerExpression(state: IRBuilderState, expr: t.Expression): SsaId {
  if (t.isBooleanLiteral(expr)) {
    const id = newSsaId(state);
    emitInst(state, {
      id,
      type: "Const",
      value: expr.value,
      deps: [],
      meta: createMeta(),
    });
    return id;
  }

  if (t.isThisExpression(expr)) {
    const id = newSsaId(state);
    emitInst(state, {
      id,
      type: "LoadThis",
      deps: [],
      meta: createMeta(),
    });
    return id;
  }

  if (t.isFunctionExpression(expr)) {
    const fnName = expr.id
      ? expr.id.name
      : newFunctionId(state, `${state.functionId}__func_expr_`);
    const rawCaptures = collectFreeVariables(expr, state.functionBindings);
    const captureSet = new Set<string>(rawCaptures);

    if (expr.id) {
      captureSet.delete(expr.id.name);
    }

    const captures = Array.from(captureSet);
    const nestedSeed = Math.floor(state.rng() * 0x100000000);

    const nestedFn = translateFunctionToObfuscatedIR(expr, {
      globals: state.globals,
      globalBase: state.globalBase,
      globalStride: state.globalStride,
      seed: nestedSeed,
      functionId: fnName,
      captures,
      flattenCfg: state.flattenCfg,
    });
    state.nestedFunctions.push(nestedFn);

    const captureIds: string[] = [];
    for (const capName of captures) {
      const ptr =
        state.memLayout.get(capName) ?? resolveGlobalPtr(state, capName);
      const ptrId = newSsaId(state);
      emitInst(state, {
        id: ptrId,
        type: "Const",
        value: ptr,
        deps: [],
        meta: createMeta(),
      });
      captureIds.push(ptrId);
    }

    const closureId = newSsaId(state);
    emitInst(state, {
      id: closureId,
      type: "AllocClosure",
      targetFunc: nestedFn.id,
      captures: captureIds,
      selfRefPtr: nestedFn.selfRefPtr,
      deps: [],
      meta: createMeta(),
    });

    return closureId;
  }

  if (t.isNullLiteral(expr)) {
    const id = newSsaId(state);
    emitInst(state, {
      id,
      type: "Const",
      value: null,
      deps: [],
      meta: createMeta(),
    });
    return id;
  }

  if (t.isRegExpLiteral(expr)) {
    const id = newSsaId(state);
    emitInst(state, {
      id,
      type: "Const",
      value: new RegExp(expr.pattern, expr.flags),
      deps: [],
      meta: createMeta(),
    });
    return id;
  }

  if (t.isNumericLiteral(expr) || t.isStringLiteral(expr)) {
    const id = newSsaId(state);
    emitInst(state, {
      id,
      type: "Const",
      value: expr.value,
      deps: [],
      meta: createMeta(),
    });
    return id;
  }

  if (t.isIdentifier(expr)) {
    if (expr.name === "arguments") {
      const id = newSsaId(state);
      emitInst(state, {
        id,
        type: "LoadArgs",
        deps: [],
        meta: createMeta(),
      });
      return id;
    }
    const ptr =
      state.memLayout.get(expr.name) ?? resolveGlobalPtr(state, expr.name);

    const ptrId = newSsaId(state);
    emitInst(state, {
      id: ptrId,
      type: "Const",
      value: ptr,
      deps: [],
      meta: createMeta(),
    });

    const loadId = newSsaId(state);
    emitInst(state, {
      id: loadId,
      type: "Load",
      ptr: ptrId,
      deps: [],
      meta: createMeta(),
    });
    return loadId;
  }

  if (t.isMemberExpression(expr)) {
    const { objId, propId } = lowerMemberAccess(state, expr);
    const id = newSsaId(state);
    emitInst(state, {
      id,
      type: "GetProp",
      obj: objId,
      prop: propId,
      deps: [
        { id: objId, type: "real" },
        { id: propId, type: "real" },
      ],
      meta: createMeta(),
    });
    return id;
  }

  if (t.isBinaryExpression(expr)) {
    if (!t.isExpression(expr.left) || !t.isExpression(expr.right)) {
      throw new Error("BinaryExpression operands must be expressions");
    }

    const left = lowerExpression(state, expr.left);
    const right = lowerExpression(state, expr.right);
    const id = newSsaId(state);
    emitInst(state, {
      id,
      type: "BinOp",
      op: expr.operator,
      left,
      right,
      deps: [
        { id: left, type: "real" },
        { id: right, type: "real" },
      ],
      meta: createMeta(),
    });
    return id;
  }

  if (t.isLogicalExpression(expr)) {
    if (!t.isExpression(expr.left) || !t.isExpression(expr.right)) {
      throw new Error("LogicalExpression operands must be expressions");
    }
    if (expr.operator !== "&&" && expr.operator !== "||") {
      throw new Error(`Unsupported logical operator: ${expr.operator}`);
    }

    const leftId = lowerExpression(state, expr.left);
    const tempName = createTempVar(state, "__logical_tmp_");
    const tempPtr = state.memLayout.get(tempName);
    if (tempPtr === undefined) {
      throw new Error("LogicalExpression temp storage allocation failed");
    }

    const leftPtrId = newSsaId(state);
    emitInst(state, {
      id: leftPtrId,
      type: "Const",
      value: tempPtr,
      deps: [],
      meta: createMeta(),
    });

    const leftStoreId = newSsaId(state);
    emitInst(state, {
      id: leftStoreId,
      type: "Store",
      ptr: leftPtrId,
      val: leftId,
      deps: [],
      meta: createMeta(),
    });

    const rightBlock = createBlock(state);
    const mergeBlock = createBlock(state);

    setTerminator(state, state.currentBlock, {
      type: "Br",
      cond: leftId,
      trueTarget: expr.operator === "&&" ? rightBlock.id : mergeBlock.id,
      falseTarget: expr.operator === "&&" ? mergeBlock.id : rightBlock.id,
      meta: createMeta(),
    });

    state.currentBlock = rightBlock;
    const rightId = lowerExpression(state, expr.right);

    const rightPtrId = newSsaId(state);
    emitInst(state, {
      id: rightPtrId,
      type: "Const",
      value: tempPtr,
      deps: [],
      meta: createMeta(),
    });

    const rightStoreId = newSsaId(state);
    emitInst(state, {
      id: rightStoreId,
      type: "Store",
      ptr: rightPtrId,
      val: rightId,
      deps: [],
      meta: createMeta(),
    });

    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target: mergeBlock.id,
        meta: createMeta(),
      });
    }

    state.currentBlock = mergeBlock;
    const mergePtrId = newSsaId(state);
    emitInst(state, {
      id: mergePtrId,
      type: "Const",
      value: tempPtr,
      deps: [],
      meta: createMeta(),
    });

    const loadId = newSsaId(state);
    emitInst(state, {
      id: loadId,
      type: "Load",
      ptr: mergePtrId,
      deps: [],
      meta: createMeta(),
    });
    return loadId;
  }

  if (t.isConditionalExpression(expr)) {
    if (!t.isExpression(expr.test)) {
      throw new Error("ConditionalExpression test must be an expression");
    }
    if (!t.isExpression(expr.consequent) || !t.isExpression(expr.alternate)) {
      throw new Error("ConditionalExpression branches must be expressions");
    }

    const condId = lowerExpression(state, expr.test);
    const tempName = createTempVar(state, "__cond_tmp_");
    const tempPtr = state.memLayout.get(tempName);
    if (tempPtr === undefined) {
      throw new Error("ConditionalExpression temp storage allocation failed");
    }

    const trueBlock = createBlock(state);
    const falseBlock = createBlock(state);
    const mergeBlock = createBlock(state);

    setTerminator(state, state.currentBlock, {
      type: "Br",
      cond: condId,
      trueTarget: trueBlock.id,
      falseTarget: falseBlock.id,
      meta: createMeta(),
    });

    state.currentBlock = trueBlock;
    const trueId = lowerExpression(state, expr.consequent);
    const truePtrId = newSsaId(state);
    emitInst(state, {
      id: truePtrId,
      type: "Const",
      value: tempPtr,
      deps: [],
      meta: createMeta(),
    });
    const trueStoreId = newSsaId(state);
    emitInst(state, {
      id: trueStoreId,
      type: "Store",
      ptr: truePtrId,
      val: trueId,
      deps: [],
      meta: createMeta(),
    });
    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target: mergeBlock.id,
        meta: createMeta(),
      });
    }

    state.currentBlock = falseBlock;
    const falseId = lowerExpression(state, expr.alternate);
    const falsePtrId = newSsaId(state);
    emitInst(state, {
      id: falsePtrId,
      type: "Const",
      value: tempPtr,
      deps: [],
      meta: createMeta(),
    });
    const falseStoreId = newSsaId(state);
    emitInst(state, {
      id: falseStoreId,
      type: "Store",
      ptr: falsePtrId,
      val: falseId,
      deps: [],
      meta: createMeta(),
    });
    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target: mergeBlock.id,
        meta: createMeta(),
      });
    }

    state.currentBlock = mergeBlock;
    const mergePtrId = newSsaId(state);
    emitInst(state, {
      id: mergePtrId,
      type: "Const",
      value: tempPtr,
      deps: [],
      meta: createMeta(),
    });
    const loadId = newSsaId(state);
    emitInst(state, {
      id: loadId,
      type: "Load",
      ptr: mergePtrId,
      deps: [],
      meta: createMeta(),
    });
    return loadId;
  }

  if (t.isArrayExpression(expr)) {
    const arrayId = newSsaId(state);
    emitInst(state, {
      id: arrayId,
      type: "AllocArray",
      deps: [],
      meta: createMeta(),
    });

    const evaluatedElements: Array<{ index: number; val: SsaId }> = [];
    for (let i = 0; i < expr.elements.length; i += 1) {
      const element = expr.elements[i];
      if (element == null) {
        continue;
      }
      if (!t.isExpression(element)) {
        throw new Error("ArrayExpression elements must be expressions");
      }
      const valueId = lowerExpression(state, element);
      evaluatedElements.push({ index: i, val: valueId });
    }

    shuffleInPlace(evaluatedElements, state.rng);
    for (const element of evaluatedElements) {
      const idxId = newSsaId(state);
      emitInst(state, {
        id: idxId,
        type: "Const",
        value: element.index,
        deps: [],
        meta: createMeta(),
      });

      const setId = newSsaId(state);
      emitInst(state, {
        id: setId,
        type: "SetProp",
        obj: arrayId,
        prop: idxId,
        val: element.val,
        deps: [
          { id: arrayId, type: "real" },
          { id: idxId, type: "real" },
          { id: element.val, type: "real" },
        ],
        meta: createMeta(),
      });
    }

    return arrayId;
  }

  if (t.isObjectExpression(expr)) {
    const objId = newSsaId(state);
    emitInst(state, {
      id: objId,
      type: "AllocObject",
      deps: [],
      meta: createMeta(),
    });

    type EvaluatedProp =
      | { kind: "prop"; key: SsaId; val: SsaId }
      | { kind: "spread"; val: SsaId }
      | { kind: "def"; key: SsaId; fn: SsaId; access: SsaId };

    const resolveObjectKey = (
      key: t.ObjectProperty["key"],
      computed: boolean,
    ): SsaId => {
      if (computed) {
        if (!t.isExpression(key)) {
          throw new Error("Computed object keys must be expressions");
        }
        return lowerExpression(state, key);
      }
      if (t.isIdentifier(key)) {
        const id = newSsaId(state);
        emitInst(state, {
          id,
          type: "Const",
          value: key.name,
          deps: [],
          meta: createMeta(),
        });
        return id;
      }
      if (t.isStringLiteral(key) || t.isNumericLiteral(key)) {
        const id = newSsaId(state);
        emitInst(state, {
          id,
          type: "Const",
          value: key.value,
          deps: [],
          meta: createMeta(),
        });
        return id;
      }
      throw new Error("Unsupported object literal key");
    };

    const evaluatedProps: EvaluatedProp[] = [];
    for (const prop of expr.properties) {
      if (t.isSpreadElement(prop)) {
        if (!t.isExpression(prop.argument)) {
          throw new Error("ObjectExpression spread must be an expression");
        }
        const spreadVal = lowerExpression(state, prop.argument);
        evaluatedProps.push({ kind: "spread", val: spreadVal });
        continue;
      }

      if (t.isObjectMethod(prop)) {
        if (prop.kind !== "get" && prop.kind !== "set") {
          throw new Error("ObjectExpression methods are not supported");
        }

        const keyId = resolveObjectKey(prop.key, prop.computed);
        const fnName = newFunctionId(
          state,
          prop.kind === "get"
            ? `${state.functionId}__get_`
            : `${state.functionId}__set_`,
        );
        const fnNode = t.functionExpression(
          t.identifier(fnName),
          prop.params,
          prop.body,
          prop.generator,
          prop.async,
        );
        const captures = collectFreeVariables(fnNode, state.functionBindings);
        const nestedSeed = Math.floor(state.rng() * 0x100000000);
        const nestedFn = translateFunctionToObfuscatedIR(fnNode, {
          globals: state.globals,
          globalBase: state.globalBase,
          globalStride: state.globalStride,
          seed: nestedSeed,
          functionId: fnName,
          captures,
          flattenCfg: state.flattenCfg,
        });
        state.nestedFunctions.push(nestedFn);

        const captureIds: SsaId[] = [];
        for (const capName of captures) {
          const ptr =
            state.memLayout.get(capName) ?? resolveGlobalPtr(state, capName);
          const ptrId = newSsaId(state);
          emitInst(state, {
            id: ptrId,
            type: "Const",
            value: ptr,
            deps: [],
            meta: createMeta(),
          });
          captureIds.push(ptrId);
        }

        const fnId = newSsaId(state);
        emitInst(state, {
          id: fnId,
          type: "AllocClosure",
          targetFunc: nestedFn.id,
          captures: captureIds,
          selfRefPtr: nestedFn.selfRefPtr,
          deps: captureIds.map((id) => ({ id, type: "real" as const })),
          meta: createMeta(),
        });

        const accessId = newSsaId(state);
        emitInst(state, {
          id: accessId,
          type: "Const",
          value: prop.kind,
          deps: [],
          meta: createMeta(),
        });

        evaluatedProps.push({
          kind: "def",
          key: keyId,
          fn: fnId,
          access: accessId,
        });
        continue;
      }

      if (!t.isObjectProperty(prop)) {
        throw new Error("Unsupported object literal property");
      }

      const keyId = resolveObjectKey(prop.key, prop.computed);

      if (!t.isExpression(prop.value)) {
        throw new Error("ObjectExpression values must be expressions");
      }
      const valId = lowerExpression(state, prop.value);
      evaluatedProps.push({ kind: "prop", key: keyId, val: valId });
    }

    const pending: Array<{ key: SsaId; val: SsaId }> = [];
    const flushPending = () => {
      if (pending.length === 0) {
        return;
      }
      shuffleInPlace(pending, state.rng);
      for (const item of pending) {
        const setId = newSsaId(state);
        emitInst(state, {
          id: setId,
          type: "SetProp",
          obj: objId,
          prop: item.key,
          val: item.val,
          deps: [
            { id: objId, type: "real" },
            { id: item.key, type: "real" },
            { id: item.val, type: "real" },
          ],
          meta: createMeta(),
        });
      }
      pending.length = 0;
    };

    for (const item of evaluatedProps) {
      if (item.kind === "spread") {
        flushPending();
        const callee = lowerExpression(
          state,
          t.identifier("VM_INTRINSIC_OBJ_SPREAD"),
        );
        const callId = newSsaId(state);
        emitInst(state, {
          id: callId,
          type: "Call",
          callee,
          args: [objId, item.val],
          deps: [
            { id: callee, type: "real" },
            { id: objId, type: "real" },
            { id: item.val, type: "real" },
          ],
          meta: createMeta(),
        });
        continue;
      }

      if (item.kind === "def") {
        flushPending();
        const callee = lowerExpression(
          state,
          t.identifier("VM_INTRINSIC_DEF_PROP"),
        );
        const callId = newSsaId(state);
        emitInst(state, {
          id: callId,
          type: "Call",
          callee,
          args: [objId, item.key, item.fn, item.access],
          deps: [
            { id: callee, type: "real" },
            { id: objId, type: "real" },
            { id: item.key, type: "real" },
            { id: item.fn, type: "real" },
            { id: item.access, type: "real" },
          ],
          meta: createMeta(),
        });
        continue;
      }

      pending.push({ key: item.key, val: item.val });
    }

    flushPending();
    return objId;
  }

  if (t.isUnaryExpression(expr)) {
    if (!t.isExpression(expr.argument)) {
      throw new Error("UnaryExpression argument must be an expression");
    }

    const supportedUnaryOps = new Set([
      "-",
      "+",
      "!",
      "~",
      "typeof",
      "void",
      "delete",
    ]);
    if (!supportedUnaryOps.has(expr.operator)) {
      throw new Error(`Unsupported unary operator: ${expr.operator}`);
    }

    if (expr.operator === "delete" && t.isMemberExpression(expr.argument)) {
      const { objId, propId } = lowerMemberAccess(state, expr.argument);
      const callee = lowerExpression(
        state,
        t.identifier("VM_INTRINSIC_DELETE_PROP"),
      );
      const id = newSsaId(state);
      emitInst(state, {
        id,
        type: "Call",
        callee,
        args: [objId, propId],
        deps: [
          { id: callee, type: "real" },
          { id: objId, type: "real" },
          { id: propId, type: "real" },
        ],
        meta: createMeta(),
      });
      return id;
    }

    const arg = lowerExpression(state, expr.argument);
    const id = newSsaId(state);
    emitInst(state, {
      id,
      type: "UnOp",
      op: expr.operator,
      arg,
      deps: [{ id: arg, type: "real" }],
      meta: createMeta(),
    });
    return id;
  }

  if (t.isUpdateExpression(expr)) {
    if (!t.isExpression(expr.argument)) {
      throw new Error("UpdateExpression argument must be an expression");
    }
    if (expr.operator !== "++" && expr.operator !== "--") {
      throw new Error(`Unsupported update operator: ${expr.operator}`);
    }

    const op = expr.operator === "++" ? "+" : "-";
    const oneId = newSsaId(state);
    emitInst(state, {
      id: oneId,
      type: "Const",
      value: 1,
      deps: [],
      meta: createMeta(),
    });

    if (t.isIdentifier(expr.argument)) {
      const ptr =
        state.memLayout.get(expr.argument.name) ??
        resolveGlobalPtr(state, expr.argument.name);

      const ptrId = newSsaId(state);
      emitInst(state, {
        id: ptrId,
        type: "Const",
        value: ptr,
        deps: [],
        meta: createMeta(),
      });

      const loadId = newSsaId(state);
      emitInst(state, {
        id: loadId,
        type: "Load",
        ptr: ptrId,
        deps: [],
        meta: createMeta(),
      });

      const updatedId = newSsaId(state);
      emitInst(state, {
        id: updatedId,
        type: "BinOp",
        op,
        left: loadId,
        right: oneId,
        deps: [
          { id: loadId, type: "real" },
          { id: oneId, type: "real" },
        ],
        meta: createMeta(),
      });

      const storeId = newSsaId(state);
      emitInst(state, {
        id: storeId,
        type: "Store",
        ptr: ptrId,
        val: updatedId,
        deps: [],
        meta: createMeta(),
      });

      return expr.prefix ? updatedId : loadId;
    }

    if (t.isMemberExpression(expr.argument)) {
      const { objId, propId } = lowerMemberAccess(state, expr.argument);
      const loadId = newSsaId(state);
      emitInst(state, {
        id: loadId,
        type: "GetProp",
        obj: objId,
        prop: propId,
        deps: [
          { id: objId, type: "real" },
          { id: propId, type: "real" },
        ],
        meta: createMeta(),
      });

      const updatedId = newSsaId(state);
      emitInst(state, {
        id: updatedId,
        type: "BinOp",
        op,
        left: loadId,
        right: oneId,
        deps: [
          { id: loadId, type: "real" },
          { id: oneId, type: "real" },
        ],
        meta: createMeta(),
      });

      const storeId = newSsaId(state);
      emitInst(state, {
        id: storeId,
        type: "SetProp",
        obj: objId,
        prop: propId,
        val: updatedId,
        deps: [
          { id: objId, type: "real" },
          { id: propId, type: "real" },
          { id: updatedId, type: "real" },
        ],
        meta: createMeta(),
      });

      return expr.prefix ? updatedId : loadId;
    }

    throw new Error(
      "UpdateExpression argument must be an identifier or member expression",
    );
  }

  if (t.isAssignmentExpression(expr)) {
    const compoundOpMap: Record<string, string> = {
      "+=": "+",
      "-=": "-",
      "*=": "*",
      "/=": "/",
      "%=": "%",
      "<<=": "<<",
      ">>=": ">>",
      ">>>=": ">>>",
      "|=": "|",
      "^=": "^",
      "&=": "&",
    };

    const isSimpleAssign = expr.operator === "=";
    const compoundOp = compoundOpMap[expr.operator];
    if (!isSimpleAssign && !compoundOp) {
      throw new Error(`Unsupported assignment operator: ${expr.operator}`);
    }

    if (t.isMemberExpression(expr.left)) {
      const { objId, propId } = lowerMemberAccess(state, expr.left);
      if (isSimpleAssign) {
        const valueId = lowerExpression(state, expr.right as t.Expression);
        const id = newSsaId(state);
        emitInst(state, {
          id,
          type: "SetProp",
          obj: objId,
          prop: propId,
          val: valueId,
          deps: [
            { id: objId, type: "real" },
            { id: propId, type: "real" },
            { id: valueId, type: "real" },
          ],
          meta: createMeta(),
        });
        return valueId;
      }

      const loadId = newSsaId(state);
      emitInst(state, {
        id: loadId,
        type: "GetProp",
        obj: objId,
        prop: propId,
        deps: [
          { id: objId, type: "real" },
          { id: propId, type: "real" },
        ],
        meta: createMeta(),
      });

      const rightId = lowerExpression(state, expr.right as t.Expression);
      const updatedId = newSsaId(state);
      emitInst(state, {
        id: updatedId,
        type: "BinOp",
        op: compoundOp,
        left: loadId,
        right: rightId,
        deps: [
          { id: loadId, type: "real" },
          { id: rightId, type: "real" },
        ],
        meta: createMeta(),
      });

      const storeId = newSsaId(state);
      emitInst(state, {
        id: storeId,
        type: "SetProp",
        obj: objId,
        prop: propId,
        val: updatedId,
        deps: [
          { id: objId, type: "real" },
          { id: propId, type: "real" },
          { id: updatedId, type: "real" },
        ],
        meta: createMeta(),
      });

      return updatedId;
    }

    if (!t.isIdentifier(expr.left)) {
      throw new Error(
        "Only identifier or member assignment targets are supported",
      );
    }

    const ptr =
      state.memLayout.get(expr.left.name) ??
      resolveGlobalPtr(state, expr.left.name);

    const ptrId = newSsaId(state);
    emitInst(state, {
      id: ptrId,
      type: "Const",
      value: ptr,
      deps: [],
      meta: createMeta(),
    });

    if (isSimpleAssign) {
      const valueId = lowerExpression(state, expr.right as t.Expression);
      const storeId = newSsaId(state);
      emitInst(state, {
        id: storeId,
        type: "Store",
        ptr: ptrId,
        val: valueId,
        deps: [],
        meta: createMeta(),
      });
      return valueId;
    }

    const loadId = newSsaId(state);
    emitInst(state, {
      id: loadId,
      type: "Load",
      ptr: ptrId,
      deps: [],
      meta: createMeta(),
    });

    const rightId = lowerExpression(state, expr.right as t.Expression);
    const updatedId = newSsaId(state);
    emitInst(state, {
      id: updatedId,
      type: "BinOp",
      op: compoundOp,
      left: loadId,
      right: rightId,
      deps: [
        { id: loadId, type: "real" },
        { id: rightId, type: "real" },
      ],
      meta: createMeta(),
    });

    const storeId = newSsaId(state);
    emitInst(state, {
      id: storeId,
      type: "Store",
      ptr: ptrId,
      val: updatedId,
      deps: [],
      meta: createMeta(),
    });

    return updatedId;
  }

  if (t.isSequenceExpression(expr)) {
    if (expr.expressions.length === 0) {
      throw new Error(
        "SequenceExpression must contain at least one expression",
      );
    }

    let lastId: SsaId | null = null;
    for (const item of expr.expressions) {
      lastId = lowerExpression(state, item);
    }
    return lastId!;
  }

  if (t.isNewExpression(expr)) {
    if (!t.isExpression(expr.callee)) {
      throw new Error("NewExpression callee must be an expression");
    }

    const callee = lowerExpression(state, expr.callee);
    const args: SsaId[] = [];
    for (const arg of expr.arguments) {
      if (!t.isExpression(arg)) {
        throw new Error("NewExpression arguments must be expressions");
      }
      args.push(lowerExpression(state, arg));
    }

    const id = newSsaId(state);
    emitInst(state, {
      id,
      type: "New",
      callee,
      args,
      deps: [
        { id: callee, type: "real" },
        ...args.map((arg) => ({ id: arg, type: "real" as const })),
      ],
      meta: createMeta(),
    });
    return id;
  }

  if (t.isCallExpression(expr)) {
    if (!t.isExpression(expr.callee)) {
      throw new Error("CallExpression callee must be an expression");
    }

    let callee: SsaId;
    let thisArg: SsaId | undefined;
    if (t.isMemberExpression(expr.callee)) {
      const { objId, propId } = lowerMemberAccess(state, expr.callee);
      thisArg = objId;
      callee = newSsaId(state);
      emitInst(state, {
        id: callee,
        type: "GetProp",
        obj: objId,
        prop: propId,
        deps: [
          { id: objId, type: "real" },
          { id: propId, type: "real" },
        ],
        meta: createMeta(),
      });
    } else {
      callee = lowerExpression(state, expr.callee);
    }

    const args: SsaId[] = [];
    for (const arg of expr.arguments) {
      if (!t.isExpression(arg)) {
        throw new Error("CallExpression arguments must be expressions");
      }
      args.push(lowerExpression(state, arg));
    }

    const directEval =
      thisArg === undefined && t.isIdentifier(expr.callee, { name: "eval" });
    const id = newSsaId(state);
    emitInst(state, {
      id,
      type: "Call",
      callee,
      args,
      thisArg,
      directEval,
      evalScope: directEval
        ? Object.fromEntries(state.memLayout.entries())
        : undefined,
      deps: [
        { id: callee, type: "real" },
        ...(thisArg ? [{ id: thisArg, type: "real" as const }] : []),
        ...args.map((arg) => ({ id: arg, type: "real" as const })),
      ],
      meta: createMeta(),
    });
    return id;
  }

  throw new Error(`Unsupported expression: ${expr.type}`);
}

function lowerMemberAccess(state: IRBuilderState, expr: t.MemberExpression) {
  if (!t.isExpression(expr.object)) {
    throw new Error("MemberExpression object must be an expression");
  }

  const objId = lowerExpression(state, expr.object);
  let propId: SsaId;

  if (expr.computed) {
    if (!t.isExpression(expr.property)) {
      throw new Error("Computed member property must be an expression");
    }
    propId = lowerExpression(state, expr.property);
  } else {
    if (!t.isIdentifier(expr.property)) {
      throw new Error("Non-computed member property must be an identifier");
    }
    const id = newSsaId(state);
    emitInst(state, {
      id,
      type: "Const",
      value: expr.property.name,
      deps: [],
      meta: createMeta(),
    });
    propId = id;
  }

  return { objId, propId };
}

function setTerminator(
  state: IRBuilderState,
  block: BasicBlock,
  term: Terminator,
) {
  block.term = term;
  state.terminatedBlocks.add(block.id);
}

function isTerminated(state: IRBuilderState, block: BasicBlock): boolean {
  return state.terminatedBlocks.has(block.id);
}

function isStaticSwitchCaseTest(
  test: t.Expression | null | undefined,
): boolean {
  if (test == null) {
    return true;
  }
  return (
    t.isStringLiteral(test) ||
    t.isNumericLiteral(test) ||
    t.isBooleanLiteral(test) ||
    t.isNullLiteral(test) ||
    t.isBigIntLiteral(test)
  );
}

function getSwitchCaseKey(test: t.Expression): string {
  if (t.isStringLiteral(test)) {
    return `string:${JSON.stringify(test.value)}`;
  }
  if (t.isNumericLiteral(test)) {
    return `number:${Object.is(test.value, -0) ? "-0" : String(test.value)}`;
  }
  if (t.isBooleanLiteral(test)) {
    return `boolean:${String(test.value)}`;
  }
  if (t.isNullLiteral(test)) {
    return "null";
  }
  if (t.isBigIntLiteral(test)) {
    return `bigint:${test.value}`;
  }
  throw new Error("Switch case must be a literal constant");
}

function createTempVar(state: IRBuilderState, prefix: string): string {
  let suffix = 0;
  let name = "";
  do {
    name = `${prefix}${state.ssaCounter}_${suffix}`;
    suffix += 1;
  } while (state.memLayout.has(name));

  const ptr = allocPtr(state);
  state.memLayout.set(name, ptr);
  return name;
}

function createSwitchTempVar(state: IRBuilderState): string {
  return createTempVar(state, "__switch_tmp_");
}

function lowerForInAsFor(
  state: IRBuilderState,
  stmt: t.ForInStatement,
  labelName?: string,
) {
  if (!t.isExpression(stmt.right)) {
    throw new Error("ForInStatement right must be an expression");
  }

  const objTemp = createTempVar(state, "__forin_obj_");
  const keysTemp = createTempVar(state, "__forin_keys_");
  const idxTemp = createTempVar(state, "__forin_idx_");

  const objDecl = t.variableDeclaration("var", [
    t.variableDeclarator(
      t.identifier(objTemp),
      t.cloneNode(stmt.right, true) as t.Expression,
    ),
  ]);

  const keysCall = t.callExpression(t.identifier("VM_INTRINSIC_KEYS"), [
    t.identifier(objTemp),
  ]);
  const keysDecl = t.variableDeclaration("var", [
    t.variableDeclarator(t.identifier(keysTemp), keysCall),
  ]);

  let leftTarget: t.LVal;
  if (t.isVariableDeclaration(stmt.left)) {
    if (stmt.left.kind !== "var") {
      throw new Error(
        `ForInStatement left must be a var declaration (got '${stmt.left.kind}')`,
      );
    }
    if (stmt.left.declarations.length !== 1) {
      throw new Error("ForInStatement must declare a single identifier");
    }
    const decl = stmt.left.declarations[0];
    if (!t.isIdentifier(decl.id)) {
      throw new Error("ForInStatement declaration must be an identifier");
    }
    leftTarget = t.identifier(decl.id.name);
  } else if (t.isIdentifier(stmt.left) || t.isMemberExpression(stmt.left)) {
    leftTarget = t.cloneNode(stmt.left, true) as t.LVal;
  } else {
    throw new Error(
      "ForInStatement left must be an identifier or member expression",
    );
  }

  const keyExpr = t.memberExpression(
    t.identifier(keysTemp),
    t.identifier(idxTemp),
    true,
  );
  const assignStmt = t.expressionStatement(
    t.assignmentExpression("=", leftTarget, keyExpr),
  );

  const bodyStatements: t.Statement[] = [assignStmt];
  if (t.isBlockStatement(stmt.body)) {
    for (const inner of stmt.body.body) {
      bodyStatements.push(t.cloneNode(inner, true) as t.Statement);
    }
  } else {
    bodyStatements.push(t.cloneNode(stmt.body, true) as t.Statement);
  }

  const initDecl = t.variableDeclaration("var", [
    t.variableDeclarator(t.identifier(idxTemp), t.numericLiteral(0)),
  ]);
  const testExpr = t.binaryExpression(
    "<",
    t.identifier(idxTemp),
    t.memberExpression(t.identifier(keysTemp), t.identifier("length")),
  );
  const updateExpr = t.assignmentExpression(
    "=",
    t.identifier(idxTemp),
    t.binaryExpression("+", t.identifier(idxTemp), t.numericLiteral(1)),
  );

  const forStmt = t.forStatement(
    initDecl,
    testExpr,
    updateExpr,
    t.blockStatement(bodyStatements),
  );

  lowerStatement(state, objDecl, false);
  lowerStatement(state, keysDecl, false);
  lowerStatement(state, forStmt, false, labelName);
}

function lowerSwitchAsIfChain(state: IRBuilderState, stmt: t.SwitchStatement) {
  const tempName = createSwitchTempVar(state);
  const tempId = t.identifier(tempName);

  const tempDecl = t.variableDeclaration("var", [
    t.variableDeclarator(
      t.identifier(tempName),
      t.cloneNode(stmt.discriminant, true) as t.Expression,
    ),
  ]);

  const fallthroughBodies: t.Statement[][] = [];
  for (let i = 0; i < stmt.cases.length; i += 1) {
    const body: t.Statement[] = [];
    for (let j = i; j < stmt.cases.length; j += 1) {
      for (const inner of stmt.cases[j].consequent) {
        body.push(t.cloneNode(inner, true) as t.Statement);
      }
    }
    fallthroughBodies.push(body);
  }

  let chain: t.Statement | null = null;
  let currentIf: t.IfStatement | null = null;
  let defaultBlock: t.BlockStatement | null = null;

  for (let i = 0; i < stmt.cases.length; i += 1) {
    const caseNode = stmt.cases[i];
    const body = t.blockStatement(fallthroughBodies[i]);
    if (caseNode.test == null) {
      defaultBlock = body;
      continue;
    }
    if (!t.isExpression(caseNode.test)) {
      throw new Error("Switch case test must be an expression");
    }

    const testExpr = t.binaryExpression(
      "===",
      t.cloneNode(tempId) as t.Expression,
      t.cloneNode(caseNode.test, true) as t.Expression,
    );
    const ifStmt = t.ifStatement(testExpr, body);
    if (!chain) {
      chain = ifStmt;
      currentIf = ifStmt;
    } else {
      currentIf!.alternate = ifStmt;
      currentIf = ifStmt;
    }
  }

  if (currentIf && defaultBlock) {
    currentIf.alternate = defaultBlock;
  }

  lowerStatement(state, tempDecl, false);

  if (chain) {
    lowerStatement(state, chain, false);
    return;
  }

  if (defaultBlock) {
    for (const inner of defaultBlock.body) {
      lowerStatement(state, inner, false);
      if (isTerminated(state, state.currentBlock)) {
        break;
      }
    }
  }
}

function resolveLabelTarget(state: IRBuilderState, name: string) {
  for (let i = state.labelStack.length - 1; i >= 0; i -= 1) {
    if (state.labelStack[i].name === name) {
      return state.labelStack[i];
    }
  }
  return undefined;
}

function isLoopStatement(
  stmt: t.Statement,
): stmt is
  | t.WhileStatement
  | t.DoWhileStatement
  | t.ForStatement
  | t.ForInStatement {
  return (
    t.isWhileStatement(stmt) ||
    t.isDoWhileStatement(stmt) ||
    t.isForStatement(stmt) ||
    t.isForInStatement(stmt)
  );
}

function lowerStatement(
  state: IRBuilderState,
  stmt: t.Statement,
  allowFunctionDecl = false,
  labelName?: string,
) {
  if (isTerminated(state, state.currentBlock)) {
    return;
  }

  if (t.isBreakStatement(stmt)) {
    let target: BlockId | undefined;
    if (stmt.label) {
      target = resolveLabelTarget(state, stmt.label.name)?.breakTarget;
      if (!target) {
        throw new Error(
          `Break label '${stmt.label.name}' is not defined in this scope.`,
        );
      }
    } else {
      target = state.breakStack[state.breakStack.length - 1];
      if (!target) {
        throw new Error(
          "BreakStatement encountered outside of breakable scope",
        );
      }
    }

    for (let i = state.finallyStack.length - 1; i >= 0; i--) {
      const finallyBlock = state.finallyStack[i];
      for (const inner of finallyBlock.body) {
        lowerStatement(state, inner, false);
      }
    }

    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target,
        meta: createMeta(),
      });
    }
    return;
  }

  if (t.isContinueStatement(stmt)) {
    let target: BlockId | undefined;
    if (stmt.label) {
      target = resolveLabelTarget(state, stmt.label.name)?.continueTarget;
      if (!target) {
        throw new Error(
          `Continue label '${stmt.label.name}' is not defined for a loop scope.`,
        );
      }
    } else {
      target = state.continueStack[state.continueStack.length - 1];
      if (!target) {
        throw new Error("ContinueStatement encountered outside of loop scope");
      }
    }

    for (let i = state.finallyStack.length - 1; i >= 0; i--) {
      const finallyBlock = state.finallyStack[i];
      for (const inner of finallyBlock.body) {
        lowerStatement(state, inner, false);
      }
    }

    if (!isTerminated(state, state.currentBlock)) {
      const meta = createMeta();
      meta.pinned = true;
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target,
        meta,
      });
    }
    state.currentBlock = createBlock(state);
    return;
  }

  if (t.isEmptyStatement(stmt)) {
    const id = newSsaId(state);
    emitInst(state, {
      id,
      type: "Nop",
      deps: [],
      meta: createMeta(),
    });
    return;
  }

  if (t.isLabeledStatement(stmt)) {
    const label = stmt.label.name;
    const body = stmt.body;

    if (t.isFunctionDeclaration(body)) {
      throw new Error(
        "Strict-Mode ES5 Violation: FunctionDeclaration inside a block is forbidden.",
      );
    }

    if (isLoopStatement(body)) {
      return lowerStatement(state, body, false, label);
    }

    const start = createBlock(state);
    const end = createBlock(state);
    setTerminator(state, state.currentBlock, {
      type: "Jmp",
      target: start.id,
      meta: createMeta(),
    });

    state.labelStack.push({ name: label, breakTarget: end.id });
    state.currentBlock = start;
    lowerStatement(state, body, false);
    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target: end.id,
        meta: createMeta(),
      });
    }
    state.currentBlock = end;
    state.labelStack.pop();
    return;
  }

  if (t.isDebuggerStatement(stmt)) {
    const id = newSsaId(state);
    emitInst(state, {
      id,
      type: "Debugger",
      deps: [],
      meta: createMeta(),
    });
    return;
  }

  if (t.isFunctionDeclaration(stmt)) {
    if (!allowFunctionDecl) {
      throw new Error(
        "Strict-Mode ES5 Violation: FunctionDeclaration inside a block is forbidden.",
      );
    }
    if (!stmt.id) {
      throw new Error("FunctionDeclaration must have a name.");
    }

    const targetFunc = newFunctionId(
      state,
      `${state.functionId}_func_${stmt.id.name}_`,
    );
    const captures = collectFreeVariables(stmt, state.functionBindings);
    const nestedSeed = Math.floor(state.rng() * 0x100000000);
    const nestedFn = translateFunctionToObfuscatedIR(stmt, {
      globals: state.globals,
      globalBase: state.globalBase,
      globalStride: state.globalStride,
      seed: nestedSeed,
      functionId: targetFunc,
      captures,
      flattenCfg: state.flattenCfg,
    });
    state.nestedFunctions.push(nestedFn);

    const captureIds: SsaId[] = [];
    for (const name of captures) {
      const ptr = state.memLayout.get(name);
      if (ptr === undefined) {
        throw new Error(`Missing capture binding for '${name}'.`);
      }

      const ptrId = newSsaId(state);
      emitInst(state, {
        id: ptrId,
        type: "Const",
        value: ptr,
        deps: [],
        meta: createMeta(),
      });
      captureIds.push(ptrId);
    }

    const closureId = newSsaId(state);
    emitInst(state, {
      id: closureId,
      type: "AllocClosure",
      targetFunc,
      captures: captureIds,
      deps: captureIds.map((id) => ({ id, type: "real" as const })),
      meta: createMeta(),
    });

    const ptr = state.memLayout.get(stmt.id.name);
    if (ptr === undefined) {
      throw new Error(`Missing function binding for '${stmt.id.name}'.`);
    }

    const ptrId = newSsaId(state);
    emitInst(state, {
      id: ptrId,
      type: "Const",
      value: ptr,
      deps: [],
      meta: createMeta(),
    });

    const storeId = newSsaId(state);
    emitInst(state, {
      id: storeId,
      type: "Store",
      ptr: ptrId,
      val: closureId,
      deps: [],
      meta: createMeta(),
    });
    return;
  }

  if (t.isBlockStatement(stmt)) {
    const blockStart = createBlock(state);
    const blockEnd = createBlock(state);

    setTerminator(state, state.currentBlock, {
      type: "Jmp",
      target: blockStart.id,
      meta: createMeta(),
    });

    state.currentBlock = blockStart;
    for (const inner of stmt.body) {
      lowerStatement(state, inner, false);
      if (isTerminated(state, state.currentBlock)) {
        break;
      }
    }

    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target: blockEnd.id,
        meta: createMeta(),
      });
    }

    state.currentBlock = blockEnd;
    return;
  }

  if (t.isWithStatement(stmt)) {
    throw new Error(
      "Strict-Mode ES5 Violation: The 'with' statement is strictly forbidden.",
    );
  }

  if (t.isThrowStatement(stmt)) {
    if (!stmt.argument || !t.isExpression(stmt.argument)) {
      throw new Error("ThrowStatement must have an expression argument");
    }
    const valId = lowerExpression(state, stmt.argument);
    const id = newSsaId(state);
    emitInst(state, {
      id,
      type: "Throw",
      val: valId,
      deps: [{ id: valId, type: "real" }],
      meta: createMeta(),
    });
    setTerminator(state, state.currentBlock, {
      type: "Ret",
      val: null,
      meta: createMeta(),
    });
    return;
  }

  if (t.isTryStatement(stmt)) {
    if (!stmt.handler && !stmt.finalizer) {
      throw new Error("TryStatement must have a catch or finally block");
    }

    if (!stmt.handler && stmt.finalizer) {
      const b_after_try = createBlock(
        state,
        allocateBlockId(state, "b_after_try_"),
      );
      const b_synthetic_catch = createBlock(
        state,
        allocateBlockId(state, "b_synthetic_catch_"),
      );

      const catchPtr = allocPtr(state);
      b_synthetic_catch.catchParamPtr = catchPtr;

      state.activeCatchStack.push(b_synthetic_catch.id);

      if (state.currentBlock.insts.length > 0) {
        const tryStart = createBlock(
          state,
          allocateBlockId(state, "b_try_start_"),
        );
        setTerminator(state, state.currentBlock, {
          type: "Jmp",
          target: tryStart.id,
          meta: createMeta(),
        });
        state.currentBlock = tryStart;
      }

      state.currentBlock.catchTarget = b_synthetic_catch.id;

      if (!t.isBlockStatement(stmt.finalizer)) {
        throw new Error("Finally block must be a block statement");
      }
      state.finallyStack.push(stmt.finalizer);

      for (const inner of stmt.block.body) {
        lowerStatement(state, inner, false);
        if (isTerminated(state, state.currentBlock)) {
          break;
        }
      }

      state.finallyStack.pop();

      if (!isTerminated(state, state.currentBlock)) {
        for (const inner of stmt.finalizer.body) {
          lowerStatement(state, inner, false);
          if (isTerminated(state, state.currentBlock)) {
            break;
          }
        }
        if (!isTerminated(state, state.currentBlock)) {
          setTerminator(state, state.currentBlock, {
            type: "Jmp",
            target: b_after_try.id,
            meta: createMeta(),
          });
        }
      }

      state.activeCatchStack.pop();

      state.currentBlock = b_synthetic_catch;

      const ptrId = newSsaId(state);
      emitInst(state, {
        id: ptrId,
        type: "Const",
        value: catchPtr,
        deps: [],
        meta: createMeta(),
      });

      const loadId = newSsaId(state);
      emitInst(state, {
        id: loadId,
        type: "Load",
        ptr: ptrId,
        deps: [],
        meta: createMeta(),
      });

      for (const inner of stmt.finalizer.body) {
        lowerStatement(state, inner, false);
        if (isTerminated(state, state.currentBlock)) {
          break;
        }
      }

      if (!isTerminated(state, state.currentBlock)) {
        const throwId = newSsaId(state);
        emitInst(state, {
          id: throwId,
          type: "Throw",
          val: loadId,
          deps: [{ id: loadId, type: "real" }],
          meta: createMeta(),
        });
        setTerminator(state, state.currentBlock, {
          type: "Ret",
          val: null,
          meta: createMeta(),
        });
      }

      state.currentBlock = b_after_try;
      return;
    }

    if (!stmt.handler) {
      throw new Error("TryStatement without catch is not supported yet");
    }
    if (!t.isBlockStatement(stmt.block)) {
      throw new Error("TryStatement body must be a block statement");
    }

    const tryEnd = createBlock(state, allocateBlockId(state, "b_try_end_"));
    const finallyBlock = stmt.finalizer
      ? createBlock(state, allocateBlockId(state, "b_finally_"))
      : null;
    const catchBlock = createBlock(state, allocateBlockId(state, "b_catch_"));
    const exitTarget = finallyBlock?.id ?? tryEnd.id;

    state.activeCatchStack.push(catchBlock.id);

    if (state.currentBlock.insts.length > 0) {
      const tryStart = createBlock(
        state,
        allocateBlockId(state, "b_try_start_"),
      );
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target: tryStart.id,
        meta: createMeta(),
      });
      state.currentBlock = tryStart;
    }

    state.currentBlock.catchTarget = catchBlock.id;

    for (const inner of stmt.block.body) {
      lowerStatement(state, inner, false);
      if (isTerminated(state, state.currentBlock)) {
        break;
      }
    }

    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target: exitTarget,
        meta: createMeta(),
      });
    }

    state.activeCatchStack.pop();

    state.currentBlock = catchBlock;
    const handler = stmt.handler;
    if (!handler.param || !t.isIdentifier(handler.param)) {
      throw new Error("Catch clause must declare an identifier");
    }
    if (handler.param.name === "arguments") {
      throw new Error("Catch parameter cannot be named 'arguments'");
    }

    const prevPtr = state.memLayout.get(handler.param.name);
    const catchPtr = allocPtr(state);
    state.memLayout.set(handler.param.name, catchPtr);
    catchBlock.catchParamPtr = catchPtr;

    for (const inner of handler.body.body) {
      lowerStatement(state, inner, false);
      if (isTerminated(state, state.currentBlock)) {
        break;
      }
    }

    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target: exitTarget,
        meta: createMeta(),
      });
    }

    if (prevPtr !== undefined) {
      state.memLayout.set(handler.param.name, prevPtr);
    } else {
      state.memLayout.delete(handler.param.name);
    }

    if (finallyBlock) {
      state.currentBlock = finallyBlock;
      if (!t.isBlockStatement(stmt.finalizer)) {
        throw new Error("Finally block must be a block statement");
      }
      for (const inner of stmt.finalizer.body) {
        lowerStatement(state, inner, false);
        if (isTerminated(state, state.currentBlock)) {
          break;
        }
      }
      if (!isTerminated(state, state.currentBlock)) {
        setTerminator(state, state.currentBlock, {
          type: "Jmp",
          target: tryEnd.id,
          meta: createMeta(),
        });
      }
    }

    state.currentBlock = tryEnd;
    return;
  }

  if (t.isSwitchStatement(stmt)) {
    if (!t.isExpression(stmt.discriminant)) {
      throw new Error("SwitchStatement discriminant must be an expression");
    }

    const hasDynamicCase = stmt.cases.some(
      (caseNode) => !isStaticSwitchCaseTest(caseNode.test),
    );
    if (hasDynamicCase) {
      const switchEnd = createBlock(
        state,
        allocateBlockId(state, "b_switch_end_"),
      );
      state.breakStack.push(switchEnd.id);

      lowerSwitchAsIfChain(state, stmt);
      if (!isTerminated(state, state.currentBlock)) {
        setTerminator(state, state.currentBlock, {
          type: "Jmp",
          target: switchEnd.id,
          meta: createMeta(),
        });
      }

      state.breakStack.pop();
      state.currentBlock = switchEnd;
      return;
    }

    const discriminant = lowerExpression(state, stmt.discriminant);
    const switchEnd = createBlock(
      state,
      allocateBlockId(state, "b_switch_end_"),
    );
    state.breakStack.push(switchEnd.id);

    const caseBlocks: BasicBlock[] = [];
    for (let i = 0; i < stmt.cases.length; i += 1) {
      caseBlocks.push(createBlock(state, allocateBlockId(state, "b_case_")));
    }

    let defaultBlock = switchEnd;
    for (let i = 0; i < stmt.cases.length; i += 1) {
      if (stmt.cases[i].test == null) {
        defaultBlock = caseBlocks[i];
        break;
      }
    }

    const caseMap: Record<string, BlockId> = {};
    for (let i = 0; i < stmt.cases.length; i += 1) {
      const caseNode = stmt.cases[i];
      if (caseNode.test == null) {
        continue;
      }
      if (!t.isExpression(caseNode.test)) {
        throw new Error("Switch case test must be an expression");
      }
      const key = getSwitchCaseKey(caseNode.test);
      caseMap[key] = caseBlocks[i].id;
    }

    setTerminator(state, state.currentBlock, {
      type: "Switch",
      cond: discriminant,
      cases: caseMap,
      defaultTarget: defaultBlock.id,
      meta: createMeta(),
    });

    for (let i = 0; i < stmt.cases.length; i += 1) {
      state.currentBlock = caseBlocks[i];
      for (const inner of stmt.cases[i].consequent) {
        lowerStatement(state, inner, false);
        if (isTerminated(state, state.currentBlock)) {
          break;
        }
      }

      if (!isTerminated(state, state.currentBlock)) {
        const nextTarget =
          i + 1 < stmt.cases.length ? caseBlocks[i + 1].id : switchEnd.id;
        setTerminator(state, state.currentBlock, {
          type: "Jmp",
          target: nextTarget,
          meta: createMeta(),
        });
      }
    }

    state.breakStack.pop();
    state.currentBlock = switchEnd;
    return;
  }

  if (t.isForInStatement(stmt)) {
    lowerForInAsFor(state, stmt, labelName);
    return;
  }

  if (t.isVariableDeclaration(stmt)) {
    if (stmt.kind !== "var") {
      throw new Error(`Unsupported variable declaration kind: ${stmt.kind}`);
    }
    for (const decl of stmt.declarations) {
      if (!t.isIdentifier(decl.id)) {
        throw new Error("Only identifier declarations are supported");
      }

      if (!decl.init) {
        continue;
      }

      if (!t.isExpression(decl.init)) {
        throw new Error("Variable initializer must be an expression");
      }

      const valueId = lowerExpression(state, decl.init);
      const ptr = state.memLayout.get(decl.id.name);
      if (ptr === undefined) {
        throw new Error(`Unknown identifier: ${decl.id.name}`);
      }

      const ptrId = newSsaId(state);
      emitInst(state, {
        id: ptrId,
        type: "Const",
        value: ptr,
        deps: [],
        meta: createMeta(),
      });

      const storeId = newSsaId(state);
      emitInst(state, {
        id: storeId,
        type: "Store",
        ptr: ptrId,
        val: valueId,
        deps: [],
        meta: createMeta(),
      });
    }
    return;
  }

  if (t.isExpressionStatement(stmt)) {
    if (!t.isExpression(stmt.expression)) {
      throw new Error("ExpressionStatement must contain an expression");
    }
    lowerExpression(state, stmt.expression);
    return;
  }

  if (t.isReturnStatement(stmt)) {
    let val: SsaId | null = null;
    if (stmt.argument) {
      if (!t.isExpression(stmt.argument)) {
        throw new Error("Return argument must be an expression");
      }
      val = lowerExpression(state, stmt.argument);
    }

    for (let i = state.finallyStack.length - 1; i >= 0; i--) {
      const finallyBlock = state.finallyStack[i];
      for (const inner of finallyBlock.body) {
        lowerStatement(state, inner, false);
      }
    }

    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Ret",
        val,
        meta: createMeta(),
      });
    }
    state.currentBlock = createBlock(state);
    return;
  }

  if (t.isIfStatement(stmt)) {
    if (!t.isExpression(stmt.test)) {
      throw new Error("IfStatement test must be an expression");
    }

    const cond = lowerExpression(state, stmt.test);
    const trueBlock = createBlock(state);
    const falseBlock = createBlock(state);
    const mergeBlock = createBlock(state);

    setTerminator(state, state.currentBlock, {
      type: "Br",
      cond,
      trueTarget: trueBlock.id,
      falseTarget: falseBlock.id,
      meta: createMeta(),
    });

    state.currentBlock = trueBlock;
    lowerStatement(state, stmt.consequent, false);

    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target: mergeBlock.id,
        meta: createMeta(),
      });
    }

    state.currentBlock = falseBlock;
    if (stmt.alternate) {
      lowerStatement(state, stmt.alternate, false);
    }

    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target: mergeBlock.id,
        meta: createMeta(),
      });
    }

    state.currentBlock = mergeBlock;
    return;
  }

  if (t.isDoWhileStatement(stmt)) {
    if (!t.isExpression(stmt.test)) {
      throw new Error("DoWhileStatement test must be an expression");
    }

    const body = createBlock(state);
    const cond = createBlock(state);
    const end = createBlock(state);

    state.breakStack.push(end.id);
    state.continueStack.push(cond.id);
    if (labelName) {
      state.labelStack.push({
        name: labelName,
        breakTarget: end.id,
        continueTarget: cond.id,
      });
    }

    setTerminator(state, state.currentBlock, {
      type: "Jmp",
      target: body.id,
      meta: createMeta(),
    });

    state.currentBlock = body;
    lowerStatement(state, stmt.body, false);

    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target: cond.id,
        meta: createMeta(),
      });
    }

    state.currentBlock = cond;
    const condId = lowerExpression(state, stmt.test);
    setTerminator(state, state.currentBlock, {
      type: "Br",
      cond: condId,
      trueTarget: body.id,
      falseTarget: end.id,
      meta: createMeta(),
    });

    state.currentBlock = end;
    state.breakStack.pop();
    state.continueStack.pop();
    if (labelName) {
      state.labelStack.pop();
    }
    return;
  }

  if (t.isWhileStatement(stmt)) {
    if (!t.isExpression(stmt.test)) {
      throw new Error("WhileStatement test must be an expression");
    }

    const header = createBlock(state);
    const body = createBlock(state);
    const end = createBlock(state);

    state.breakStack.push(end.id);
    state.continueStack.push(header.id);
    if (labelName) {
      state.labelStack.push({
        name: labelName,
        breakTarget: end.id,
        continueTarget: header.id,
      });
    }

    setTerminator(state, state.currentBlock, {
      type: "Jmp",
      target: header.id,
      meta: createMeta(),
    });

    state.currentBlock = header;
    const cond = lowerExpression(state, stmt.test);
    setTerminator(state, state.currentBlock, {
      type: "Br",
      cond,
      trueTarget: body.id,
      falseTarget: end.id,
      meta: createMeta(),
    });

    state.currentBlock = body;
    lowerStatement(state, stmt.body, false);

    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target: header.id,
        meta: createMeta(),
      });
    }

    state.currentBlock = end;
    state.breakStack.pop();
    state.continueStack.pop();
    if (labelName) {
      state.labelStack.pop();
    }
    return;
  }

  if (t.isForStatement(stmt)) {
    if (stmt.init) {
      if (t.isVariableDeclaration(stmt.init)) {
        lowerStatement(state, stmt.init, false);
      } else if (t.isExpression(stmt.init)) {
        lowerExpression(state, stmt.init);
      }
    }

    const header = createBlock(state);
    const body = createBlock(state);
    const update = createBlock(state);
    const end = createBlock(state);

    state.breakStack.push(end.id);
    state.continueStack.push(update.id);
    if (labelName) {
      state.labelStack.push({
        name: labelName,
        breakTarget: end.id,
        continueTarget: update.id,
      });
    }

    setTerminator(state, state.currentBlock, {
      type: "Jmp",
      target: header.id,
      meta: createMeta(),
    });

    state.currentBlock = header;
    let cond: SsaId;
    if (stmt.test && !t.isExpression(stmt.test)) {
      throw new Error("ForStatement test must be an expression");
    }
    if (stmt.test) {
      cond = lowerExpression(state, stmt.test);
    } else {
      const id = newSsaId(state);
      emitInst(state, {
        id,
        type: "Const",
        value: 1,
        deps: [],
        meta: createMeta(),
      });
      cond = id;
    }

    setTerminator(state, state.currentBlock, {
      type: "Br",
      cond,
      trueTarget: body.id,
      falseTarget: end.id,
      meta: createMeta(),
    });

    state.currentBlock = body;
    lowerStatement(state, stmt.body, false);

    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target: update.id,
        meta: createMeta(),
      });
    }

    state.currentBlock = update;
    if (
      !isTerminated(state, state.currentBlock) &&
      stmt.update &&
      t.isExpression(stmt.update)
    ) {
      lowerExpression(state, stmt.update);
    }
    if (!isTerminated(state, state.currentBlock)) {
      setTerminator(state, state.currentBlock, {
        type: "Jmp",
        target: header.id,
        meta: createMeta(),
      });
    }

    state.currentBlock = end;
    state.breakStack.pop();
    state.continueStack.pop();
    if (labelName) {
      state.labelStack.pop();
    }
    return;
  }

  throw new Error(`Unsupported statement: ${stmt.type}`);
}

function resolveGlobalPtr(state: IRBuilderState, name: string): VmPtr {
  let ptr = state.globals.get(name);
  if (ptr !== undefined) {
    return ptr;
  }

  ptr = state.globalBase + state.globals.size * state.globalStride;
  state.globals.set(name, ptr);
  return ptr;
}

function collectVarBindings(node: t.Node, isRoot: boolean, out: Set<string>) {
  if (t.isFunction(node) && !isRoot) {
    return;
  }

  if (t.isVariableDeclaration(node)) {
    if (node.kind !== "var") {
      throw new Error(`Unsupported variable declaration kind: ${node.kind}`);
    }
    for (const decl of node.declarations) {
      if (!t.isIdentifier(decl.id)) {
        throw new Error("Only identifier declarations are supported");
      }
      if (decl.id.name === "arguments") {
        throw new Error("Strict-mode bindings cannot be named 'arguments'.");
      }
      out.add(decl.id.name);
    }
    return;
  }

  const keys = t.VISITOR_KEYS[node.type] ?? [];
  for (const key of keys) {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === "object" && "type" in child) {
          collectVarBindings(child as t.Node, false, out);
        }
      }
    } else if (value && typeof value === "object" && "type" in value) {
      collectVarBindings(value as t.Node, false, out);
    }
  }
}

function collectTopLevelFunctionDecls(
  body: t.BlockStatement | t.Statement[],
): t.FunctionDeclaration[] {
  const decls: t.FunctionDeclaration[] = [];
  const stmts = Array.isArray(body) ? body : body.body;
  for (const stmt of stmts) {
    if (t.isFunctionDeclaration(stmt)) {
      if (!stmt.id) {
        throw new Error("FunctionDeclaration must have a name.");
      }
      decls.push(stmt);
    }
  }
  return decls;
}

function collectUsedIdentifiers(
  node: t.Node,
  used: Set<string>,
  isRoot: boolean,
) {
  if (t.isFunction(node) && !isRoot) {
    return;
  }

  if (t.isMemberExpression(node)) {
    if (t.isExpression(node.object)) {
      collectUsedIdentifiers(node.object, used, false);
    }
    if (node.computed && t.isExpression(node.property)) {
      collectUsedIdentifiers(node.property, used, false);
    }
    return;
  }

  if (t.isObjectProperty(node)) {
    if (node.computed && t.isExpression(node.key)) {
      collectUsedIdentifiers(node.key, used, false);
    }
    if (t.isExpression(node.value)) {
      collectUsedIdentifiers(node.value, used, false);
    }
    return;
  }

  if (t.isObjectMethod(node)) {
    return;
  }

  if (t.isFunctionDeclaration(node)) {
    return;
  }

  if (t.isVariableDeclarator(node)) {
    if (node.init && t.isExpression(node.init)) {
      collectUsedIdentifiers(node.init, used, false);
    }
    return;
  }

  if (t.isLabeledStatement(node)) {
    collectUsedIdentifiers(node.body, used, false);
    return;
  }

  if (t.isBreakStatement(node) || t.isContinueStatement(node)) {
    return;
  }

  if (t.isIdentifier(node)) {
    used.add(node.name);
    return;
  }

  const keys = t.VISITOR_KEYS[node.type] ?? [];
  for (const key of keys) {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === "object" && "type" in child) {
          collectUsedIdentifiers(child as t.Node, used, false);
        }
      }
    } else if (value && typeof value === "object" && "type" in value) {
      collectUsedIdentifiers(value as t.Node, used, false);
    }
  }
}

function collectNestedFreeVariables(
  node: t.Node,
  outerBindings: Set<string>,
  used: Set<string>,
  isRoot: boolean,
) {
  if (t.isFunction(node) && !isRoot) {
    if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) {
      for (const name of collectFreeVariables(node, outerBindings)) {
        used.add(name);
      }
    }
    return;
  }

  const keys = t.VISITOR_KEYS[node.type] ?? [];
  for (const key of keys) {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === "object" && "type" in child) {
          collectNestedFreeVariables(
            child as t.Node,
            outerBindings,
            used,
            false,
          );
        }
      }
    } else if (value && typeof value === "object" && "type" in value) {
      collectNestedFreeVariables(value as t.Node, outerBindings, used, false);
    }
  }
}

function collectFreeVariables(
  node: t.FunctionDeclaration | t.FunctionExpression,
  outerBindings: Set<string>,
): string[] {
  if (!t.isBlockStatement(node.body)) {
    throw new Error("Expected a block statement body");
  }

  const declared = new Set<string>();
  if (t.isFunctionExpression(node) && node.id) {
    declared.add(node.id.name);
  }
  for (const param of node.params) {
    if (t.isIdentifier(param)) {
      declared.add(param.name);
    }
  }

  for (const decl of collectTopLevelFunctionDecls(node.body)) {
    if (decl.id) {
      declared.add(decl.id.name);
    }
  }

  const varBindings = new Set<string>();
  collectVarBindings(node, true, varBindings);
  for (const name of varBindings) {
    declared.add(name);
  }

  const used = new Set<string>();
  collectUsedIdentifiers(node.body, used, true);
  collectNestedFreeVariables(node.body, outerBindings, used, true);

  for (const name of declared) {
    used.delete(name);
  }
  used.delete("arguments");

  return Array.from(used).filter((name) => outerBindings.has(name));
}

function injectPhiNodes(fn: IRFunction, rng: () => number) {
  const allInstIds: SsaId[] = [];
  for (const block of fn.blocks.values()) {
    for (const inst of block.insts) {
      allInstIds.push(inst.id);
    }
  }

  if (allInstIds.length < 2) {
    return;
  }

  const usedIds = new Set<SsaId>(allInstIds);
  let phiCounter = 0;
  const nextPhiId = () => {
    let id = `v_phi_${phiCounter}` as SsaId;
    phiCounter += 1;
    while (usedIds.has(id)) {
      id = `v_phi_${phiCounter}` as SsaId;
      phiCounter += 1;
    }
    usedIds.add(id);
    return id;
  };

  for (const block of fn.blocks.values()) {
    const rand1 = allInstIds[Math.floor(rng() * allInstIds.length)];
    let rand2 = allInstIds[Math.floor(rng() * allInstIds.length)];
    if (allInstIds.length > 1) {
      while (rand2 === rand1) {
        rand2 = allInstIds[Math.floor(rng() * allInstIds.length)];
      }
    }

    const phiId = nextPhiId();
    const phiInst: PhiInst = {
      id: phiId,
      type: "Phi",
      choices: [
        { block: "ANY", val: rand1 },
        { block: "ANY", val: rand2 },
      ],
      deps: [],
      meta: createMeta(),
    };

    block.insts.unshift(phiInst);

    const binOps = block.insts.filter(
      (inst) => inst.type === "BinOp",
    ) as BinOpInst[];
    if (binOps.length === 0) {
      continue;
    }

    const target = binOps[Math.floor(rng() * binOps.length)];
    target.deps.push({ id: phiId, type: "fake" });
  }
}

function flattenCfg(fn: IRFunction): void {
  for (const block of fn.blocks.values()) {
    if (block.catchTarget !== null || block.catchParamPtr !== undefined) {
      throw new Error(
        "CFG flattening does not support try/catch/finally blocks yet.",
      );
    }
  }

  const originalBlocks = Array.from(fn.blocks.values());
  if (originalBlocks.length === 0) {
    return;
  }

  const usedBlockIds = new Set<BlockId>(fn.blocks.keys());
  const usedSsaIds = new Set<SsaId>(fn.params);
  for (const block of originalBlocks) {
    for (const inst of block.insts) {
      usedSsaIds.add(inst.id);
    }
  }

  let blockCounter = 0;
  const nextBlockId = (prefix: string): BlockId => {
    let id = `${prefix}${blockCounter}` as BlockId;
    blockCounter += 1;
    while (usedBlockIds.has(id)) {
      id = `${prefix}${blockCounter}` as BlockId;
      blockCounter += 1;
    }
    usedBlockIds.add(id);
    return id;
  };

  let ssaCounter = 0;
  const nextSsaId = (): SsaId => {
    let id = `v_cfg_${ssaCounter}` as SsaId;
    ssaCounter += 1;
    while (usedSsaIds.has(id)) {
      id = `v_cfg_${ssaCounter}` as SsaId;
      ssaCounter += 1;
    }
    usedSsaIds.add(id);
    return id;
  };

  let stateName = "__cfg_state";
  let stateNameCounter = 0;
  while (Object.prototype.hasOwnProperty.call(fn.memLayout, stateName)) {
    stateName = `__cfg_state_${stateNameCounter}`;
    stateNameCounter += 1;
  }

  const maxPtr = Object.values(fn.memLayout).reduce(
    (max, ptr) => Math.max(max, ptr),
    -4,
  );
  const statePtr = maxPtr + 4;
  fn.memLayout[stateName] = statePtr;

  const stateByBlock = new Map<BlockId, number>();
  for (let i = 0; i < originalBlocks.length; i += 1) {
    stateByBlock.set(originalBlocks[i].id, i);
  }

  const dispatchBlockId = nextBlockId("b_cfg_dispatch_");

  const makeBlock = (id: BlockId): BasicBlock => ({
    id,
    insts: [],
    term: {
      type: "Ret",
      val: null,
      meta: createMeta(),
    },
    meta: createMeta(),
    catchTarget: null,
  });

  const appendStateStore = (block: BasicBlock, target: BlockId): void => {
    const state = stateByBlock.get(target);
    if (state === undefined) {
      throw new Error(
        `CFG flattening failed: target block '${target}' missing.`,
      );
    }

    const ptrId = nextSsaId();
    block.insts.push({
      id: ptrId,
      type: "Const",
      value: statePtr,
      deps: [],
      meta: createMeta(),
    });

    const valueId = nextSsaId();
    block.insts.push({
      id: valueId,
      type: "Const",
      value: state,
      deps: [],
      meta: createMeta(),
    });

    const storeId = nextSsaId();
    block.insts.push({
      id: storeId,
      type: "Store",
      ptr: ptrId,
      val: valueId,
      deps: [],
      meta: createMeta(),
    });
  };

  const createStateSetterBlock = (target: BlockId): BlockId => {
    const block = makeBlock(nextBlockId("b_cfg_set_"));
    appendStateStore(block, target);
    block.term = {
      type: "Jmp",
      target: dispatchBlockId,
      meta: createMeta(),
    };
    fn.blocks.set(block.id, block);
    return block.id;
  };

  const flattenedEntry = makeBlock(nextBlockId("b_cfg_entry_"));
  appendStateStore(flattenedEntry, fn.entry);
  flattenedEntry.term = {
    type: "Jmp",
    target: dispatchBlockId,
    meta: createMeta(),
  };

  const dispatchBlock = makeBlock(dispatchBlockId);
  const statePtrId = nextSsaId();
  dispatchBlock.insts.push({
    id: statePtrId,
    type: "Const",
    value: statePtr,
    deps: [],
    meta: createMeta(),
  });

  const stateValueId = nextSsaId();
  dispatchBlock.insts.push({
    id: stateValueId,
    type: "Load",
    ptr: statePtrId,
    deps: [],
    meta: createMeta(),
  });

  const dispatchCases: Record<string, BlockId> = {};
  for (const [blockId, state] of stateByBlock.entries()) {
    dispatchCases[`number:${state}`] = blockId;
  }
  dispatchBlock.term = {
    type: "Switch",
    cond: stateValueId,
    cases: dispatchCases,
    defaultTarget: fn.entry,
    meta: createMeta(),
  };

  for (const block of originalBlocks) {
    const term = block.term;
    if (term.type === "Jmp") {
      appendStateStore(block, term.target);
      block.term = {
        type: "Jmp",
        target: dispatchBlockId,
        meta: createMeta(),
      };
    } else if (term.type === "Br") {
      block.term = {
        type: "Br",
        cond: term.cond,
        trueTarget: createStateSetterBlock(term.trueTarget),
        falseTarget: createStateSetterBlock(term.falseTarget),
        meta: createMeta(),
      };
    } else if (term.type === "Switch") {
      const cases: Record<string, BlockId> = {};
      for (const [key, target] of Object.entries(term.cases)) {
        cases[key] = createStateSetterBlock(target);
      }
      block.term = {
        type: "Switch",
        cond: term.cond,
        cases,
        defaultTarget: createStateSetterBlock(term.defaultTarget),
        meta: createMeta(),
      };
    }
  }

  fn.blocks.set(flattenedEntry.id, flattenedEntry);
  fn.blocks.set(dispatchBlock.id, dispatchBlock);
  fn.entry = flattenedEntry.id;
}

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function translateFunctionToObfuscatedIR(
  node: t.FunctionDeclaration | t.FunctionExpression,
  options?: {
    globals?: Map<string, VmPtr>;
    globalBase?: VmPtr;
    globalStride?: VmPtr;
    seed?: number;
    functionId?: string;
    captures?: string[];
    flattenCfg?: boolean;
  },
): IRFunction {
  const memLayout = new Map<string, VmPtr>();
  const blocks = new Map<BlockId, BasicBlock>();
  const globals = options?.globals ?? new Map<string, VmPtr>();
  const globalBase = options?.globalBase ?? DEFAULT_GLOBAL_BASE;
  const globalStride = options?.globalStride ?? DEFAULT_GLOBAL_STRIDE;
  const functionId = options?.functionId ?? node.id?.name ?? "anonymous";

  const rng =
    options?.seed === undefined ? Math.random : createSeededRng(options.seed);
  const nestedFunctions: IRFunction[] = [];

  const state: IRBuilderState = {
    memLayout,
    globals,
    blocks,
    currentBlock: undefined as unknown as BasicBlock,
    rng,
    nestedFunctions,
    functionBindings: new Set<string>(),
    functionId,
    ssaCounter: 0,
    functionCounter: 0,
    nextBlockId: 0,
    nextPtr: 0,
    globalBase,
    globalStride,
    terminatedBlocks: new Set(),
    breakStack: [],
    continueStack: [],
    activeCatchStack: [],
    labelStack: [],
    finallyStack: [],
    flattenCfg: options?.flattenCfg ?? false,
  };

  const entry = createBlock(state, "b_entry");
  state.currentBlock = entry;

  const captureNames = options?.captures ?? [];
  for (const name of captureNames) {
    if (!memLayout.has(name)) {
      const ptr = allocPtr(state);
      memLayout.set(name, ptr);
    }
  }

  const paramNames = new Set<string>();
  const params: t.Identifier[] = [];
  for (const param of node.params) {
    if (!t.isIdentifier(param)) {
      throw new Error("Only identifier parameters are supported");
    }
    if (param.name === "arguments") {
      throw new Error("Strict-mode parameters cannot be named 'arguments'.");
    }
    const ptr = allocPtr(state);
    memLayout.set(param.name, ptr);
    paramNames.add(param.name);
    params.push(param);
  }

  if (!t.isBlockStatement(node.body)) {
    throw new Error("Expected a block statement body");
  }

  const bindings = new Set<string>();
  if (t.isFunctionExpression(node) && node.id) {
    bindings.add(node.id.name);
  }

  const varBindings = new Set<string>();
  collectVarBindings(node, true, varBindings);

  for (const decl of collectTopLevelFunctionDecls(node.body)) {
    if (decl.id) {
      bindings.add(decl.id.name);
    }
  }

  for (const name of varBindings) {
    bindings.add(name);
  }

  for (const name of bindings) {
    if (memLayout.has(name)) {
      continue;
    }
    const ptr = allocPtr(state);
    memLayout.set(name, ptr);
  }

  state.functionBindings = new Set<string>([
    ...captureNames,
    ...bindings,
    ...paramNames,
  ]);

  if (params.length > 0) {
    const argsId = newSsaId(state);
    emitInst(state, {
      id: argsId,
      type: "LoadArgs",
      deps: [],
      meta: createMeta(),
    });

    for (let i = 0; i < params.length; i += 1) {
      const paramName = params[i].name;
      const ptr = memLayout.get(paramName);
      if (ptr === undefined) {
        throw new Error(`Missing parameter binding for '${paramName}'.`);
      }

      const idxId = newSsaId(state);
      emitInst(state, {
        id: idxId,
        type: "Const",
        value: i,
        deps: [],
        meta: createMeta(),
      });

      const argValId = newSsaId(state);
      emitInst(state, {
        id: argValId,
        type: "GetProp",
        obj: argsId,
        prop: idxId,
        deps: [
          { id: argsId, type: "real" },
          { id: idxId, type: "real" },
        ],
        meta: createMeta(),
      });

      const ptrId = newSsaId(state);
      emitInst(state, {
        id: ptrId,
        type: "Const",
        value: ptr,
        deps: [],
        meta: createMeta(),
      });

      const storeId = newSsaId(state);
      emitInst(state, {
        id: storeId,
        type: "Store",
        ptr: ptrId,
        val: argValId,
        deps: [],
        meta: createMeta(),
      });
    }
  }

  const initializedVars = new Set<string>();
  for (const name of varBindings) {
    if (initializedVars.has(name) || paramNames.has(name)) {
      continue;
    }
    const ptr = memLayout.get(name);
    if (ptr === undefined) {
      throw new Error(`Missing hoisted binding for '${name}'`);
    }

    const ptrId = newSsaId(state);
    emitInst(state, {
      id: ptrId,
      type: "Const",
      value: ptr,
      deps: [],
      meta: createMeta(),
    });

    const undefId = newSsaId(state);
    emitInst(state, {
      id: undefId,
      type: "Const",
      value: undefined,
      deps: [],
      meta: createMeta(),
    });

    const storeId = newSsaId(state);
    emitInst(state, {
      id: storeId,
      type: "Store",
      ptr: ptrId,
      val: undefId,
      deps: [],
      meta: createMeta(),
    });

    initializedVars.add(name);
  }

  for (const stmt of node.body.body) {
    lowerStatement(state, stmt, true);
    if (isTerminated(state, state.currentBlock)) {
      break;
    }
  }

  if (!isTerminated(state, state.currentBlock)) {
    setTerminator(state, state.currentBlock, {
      type: "Ret",
      val: null,
      meta: createMeta(),
    });
  }

  let selfRefPtr: number | undefined;
  if (t.isFunctionExpression(node) && node.id) {
    selfRefPtr = memLayout.get(node.id.name);
  }

  const fn: IRFunction = {
    id: functionId,
    params: node.params
      .filter((param): param is t.Identifier => t.isIdentifier(param))
      .map((param) => param.name),
    blocks,
    entry: entry.id,
    memLayout: Object.fromEntries(memLayout.entries()),
    globals:
      globals.size > 0 ? Object.fromEntries(globals.entries()) : undefined,
    nestedFunctions: nestedFunctions.length > 0 ? nestedFunctions : undefined,
    captures: captureNames.length > 0 ? [...captureNames] : undefined,
    selfRefPtr,
  };

  if (options?.flattenCfg) {
    flattenCfg(fn);
  }

  injectPhiNodes(fn, rng);
  return fn;
}

export function translateProgramToObfuscatedIR(
  node: t.Program,
  options?: {
    globals?: Map<string, VmPtr>;
    globalBase?: VmPtr;
    globalStride?: VmPtr;
    seed?: number;
    flattenCfg?: boolean;
  },
): IRProgram {
  const memLayout = new Map<string, VmPtr>();
  const blocks = new Map<BlockId, BasicBlock>();
  const globals = options?.globals ?? new Map<string, VmPtr>();
  const globalBase = options?.globalBase ?? DEFAULT_GLOBAL_BASE;
  const globalStride = options?.globalStride ?? DEFAULT_GLOBAL_STRIDE;

  const rng =
    options?.seed === undefined ? Math.random : createSeededRng(options.seed);
  const nestedFunctions: IRFunction[] = [];

  const state: IRBuilderState = {
    memLayout,
    globals,
    blocks,
    currentBlock: undefined as unknown as BasicBlock,
    rng,
    nestedFunctions,
    functionBindings: new Set<string>(),
    functionId: "func_main",
    ssaCounter: 0,
    functionCounter: 0,
    nextBlockId: 0,
    nextPtr: 0,
    globalBase,
    globalStride,
    terminatedBlocks: new Set(),
    breakStack: [],
    continueStack: [],
    activeCatchStack: [],
    labelStack: [],
    finallyStack: [],
    flattenCfg: options?.flattenCfg ?? false,
  };

  const entry = createBlock(state, "b_entry");
  state.currentBlock = entry;

  const bindings = new Set<string>();

  const varBindings = new Set<string>();
  for (const stmt of node.body) {
    collectVarBindings(stmt, true, varBindings);
  }

  for (const decl of collectTopLevelFunctionDecls(node.body)) {
    if (decl.id) {
      bindings.add(decl.id.name);
    }
  }

  for (const name of varBindings) {
    bindings.add(name);
  }

  for (const name of bindings) {
    if (memLayout.has(name)) {
      continue;
    }
    const ptr = allocPtr(state);
    memLayout.set(name, ptr);
  }

  state.functionBindings = new Set<string>(bindings);

  const initializedVars = new Set<string>();
  for (const name of varBindings) {
    if (initializedVars.has(name)) {
      continue;
    }
    const ptr = memLayout.get(name);
    if (ptr === undefined) {
      throw new Error(`Missing hoisted binding for '${name}'`);
    }

    const ptrId = newSsaId(state);
    emitInst(state, {
      id: ptrId,
      type: "Const",
      value: ptr,
      deps: [],
      meta: createMeta(),
    });

    const undefId = newSsaId(state);
    emitInst(state, {
      id: undefId,
      type: "Const",
      value: undefined,
      deps: [],
      meta: createMeta(),
    });

    const storeId = newSsaId(state);
    emitInst(state, {
      id: storeId,
      type: "Store",
      ptr: ptrId,
      val: undefId,
      deps: [],
      meta: createMeta(),
    });

    initializedVars.add(name);
  }

  for (const stmt of node.body) {
    lowerStatement(state, stmt, true);
    if (isTerminated(state, state.currentBlock)) {
      break;
    }
  }

  if (!isTerminated(state, state.currentBlock)) {
    setTerminator(state, state.currentBlock, {
      type: "Ret",
      val: null,
      meta: createMeta(),
    });
  }

  const fn: IRFunction = {
    id: "func_main",
    params: [],
    blocks,
    entry: entry.id,
    memLayout: Object.fromEntries(memLayout.entries()),
    nestedFunctions:
      state.nestedFunctions.length > 0 ? state.nestedFunctions : undefined,
  };

  if (options?.flattenCfg) {
    flattenCfg(fn);
  }

  injectPhiNodes(fn, rng);

  const functionMap = new Map<string, IRFunction>();
  functionMap.set(fn.id, fn);

  const extractNested = (func: IRFunction) => {
    if (func.nestedFunctions) {
      for (const nested of func.nestedFunctions) {
        functionMap.set(nested.id, nested);
        extractNested(nested);
      }
    }
  };
  extractNested(fn);

  return {
    functions: functionMap,
    globals: globals.size > 0 ? Object.fromEntries(globals.entries()) : {},
    entryPoint: "func_main",
  };
}
