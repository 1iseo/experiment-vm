import * as t from "@babel/types";

type IRProgram = {
  functions: IRFunction[];
};

type IRFunction = {
  id: string;
  entry: BlockId;
  blocks: Map<BlockId, IRBlock>;
  instructions: Map<InstrId, IRInstruction>;

  // Registry nilai SSA
  values: Map<ValueId, IRValue>;

  // Opsional: metadata global
  meta?: Record<string, any>;
};

type BlockId = string;

type IRBlock = {
  id: BlockId;

  instructions: InstrId[];

  // Alur kontrol eksplisit
  terminator: IRTerminator;

  // Untuk analisis / obfuskasi
  predecessors: BlockId[];
  successors: BlockId[];

  meta?: BlockMeta;
};

type BlockMeta = {
  isFake?: boolean;
  flattenable?: boolean;
};

type ValueId = string;

type IRValue = {
  id: ValueId;

  // Instruksi yang mendefinisikannya
  def: InstrId;

  // Dependensi (tepi dalam graf SSA)
  deps: Dependency[];

  // Siapa yang menggunakan nilai ini
  uses: InstrId[];

  // Tipe bersifat opsional (JS bersifat dinamis)
  type?: IRType;

  meta?: ValueMeta;
};

type Dependency = {
  value: ValueId;

  kind: "real" | "fake" | "ghost";
};

type InstrId = string;

type IRInstruction =
  | IRConst
  | IRBinaryOp
  | IRUnaryOp
  | IRPhi
  | IRLoad
  | IRStore
  | IRCall
  | IRMove
  | IRNop;

type BaseInstr = {
  id: InstrId;
  outputs: ValueId[];

  meta?: InstrMeta;
};

type InstrMeta = {
  reorderable?: boolean;
  duplicable?: boolean;
  opaque?: boolean;
};

type ValueMeta = {
  isGhost?: boolean;
  splitFrom?: ValueId;
};

type IRType =
  | { kind: "number" }
  | { kind: "string" }
  | { kind: "boolean" }
  | { kind: "object" }
  | { kind: "unknown" };

type IRTerminator = IRJump | IRBranch | IRReturn | IRSwitch;

type IRJump = {
  kind: "jump";
  target: BlockId;
};

type IRBranch = {
  kind: "branch";
  condition: ValueId;
  then: BlockId;
  else: BlockId;

  meta?: {
    opaque?: boolean;
  };
};

type IRSwitch = {
  kind: "switch";
  discriminant: ValueId;
  cases: { value: any; target: BlockId }[];
  default: BlockId;
};

type IRReturn = {
  kind: "return";
  value?: ValueId;
};

type IRNop = BaseInstr & {
  kind: "nop";
};

type IRMove = BaseInstr & {
  kind: "move";
  from: ValueId;
};

type IRCall = BaseInstr & {
  kind: "call";
  callee: ValueId;
  args: ValueId[];
};

type IRLoad = BaseInstr & {
  kind: "load";
  address: ValueId;
};

type IRStore = BaseInstr & {
  kind: "store";
  address: ValueId;
  value: ValueId;
};

type IRPhi = BaseInstr & {
  kind: "phi";

  // CATATAN: tidak harus terikat pada pendahulu
  inputs: ValueId[];

  // Pemetaan opsional (bisa fiktif!)
  fromBlocks?: BlockId[];
};

type IRConst = BaseInstr & {
  kind: "const";
  value: any;
};

type IRBinaryOp = BaseInstr & {
  kind: "binop";
  op: "+" | "-" | "*" | "/" | "&" | "|" | "^" | "==" | "<";
  left: ValueId;
  right: ValueId;
};

type IRUnaryOp = BaseInstr & {
  kind: "unop";
  op: "!" | "~" | "typeof";
  operand: ValueId;
};

let valueCounter = 0;
let instrCounter = 0;
let blockCounter = 0;

const newValueId = () => `v${valueCounter++}`;
const newInstrId = () => `i${instrCounter++}`;
const newBlockId = () => `b${blockCounter++}`;

export function transformFunctionToIR(node: t.Function): IRFunction {
  const entry = newBlockId();

  const irFunc: IRFunction = {
    id: "fn0",
    entry,
    blocks: new Map(),
    instructions: new Map(),
    values: new Map(),
  };

  const block: IRBlock = {
    id: entry,
    instructions: [],
    predecessors: [],
    successors: [],
    terminator: { kind: "return" },
  };

  irFunc.blocks.set(entry, block);

  // Lingkungan: variabel -> nilai SSA terbaru
  const env = new Map<string, ValueId>();
  let terminated = false;

  function emit(instr: IRInstruction): ValueId | null {
    block.instructions.push(instr.id);
    irFunc.instructions.set(instr.id, instr);

    for (const out of instr.outputs) {
      irFunc.values.set(out, {
        id: out,
        def: instr.id,
        deps: [],
        uses: [],
      });
    }

    return instr.outputs[0] ?? null;
  }

  function addDep(
    target: ValueId,
    dep: ValueId,
    kind: "real" | "fake" = "real",
  ) {
    const v = irFunc.values.get(target)!;
    v.deps.push({ value: dep, kind });

    const depVal = irFunc.values.get(dep)!;
    depVal.uses.push(v.def);
  }

  // ---- Penurunan ekspresi ----

  function lowerExpr(expr: t.Expression): ValueId {
    if (t.isNumericLiteral(expr)) {
      const out = newValueId();

      emit({
        id: newInstrId(),
        kind: "const",
        value: expr.value,
        outputs: [out],
      } as IRConst);

      return out;
    }

    if (t.isIdentifier(expr)) {
      const existing = env.get(expr.name);
      if (!existing) {
        throw new Error(`Undefined variable: ${expr.name}`);
      }
      return existing;
    }

    if (t.isBinaryExpression(expr)) {
      if (!t.isExpression(expr.left) || !t.isExpression(expr.right)) {
        throw new Error("Only simple binary expressions supported");
      }

      const left = lowerExpr(expr.left);
      const right = lowerExpr(expr.right);

      const out = newValueId();

      emit({
        id: newInstrId(),
        kind: "binop",
        op: expr.operator as IRBinaryOp["op"],
        left,
        right,
        outputs: [out],
      } as IRBinaryOp);

      addDep(out, left, "real");
      addDep(out, right, "real");

      return out;
    }

    throw new Error(`Unsupported expression: ${expr.type}`);
  }

  // ---- Penurunan pernyataan ----

  function lowerStatement(stmt: t.Statement) {
    if (terminated) {
      return;
    }

    if (t.isExpressionStatement(stmt)) {
      if (!t.isAssignmentExpression(stmt.expression)) {
        throw new Error(`Unsupported statement: ${stmt.type}`);
      }

      if (!t.isIdentifier(stmt.expression.left)) {
        throw new Error("Only simple assignments supported");
      }

      const rhs = lowerExpr(stmt.expression.right);

      const out = newValueId();

      emit({
        id: newInstrId(),
        kind: "move",
        from: rhs,
        outputs: [out],
      } as IRMove);

      addDep(out, rhs, "real");

      env.set(stmt.expression.left.name, out);
      return;
    }

    if (t.isReturnStatement(stmt)) {
      let value: ValueId | undefined;

      if (stmt.argument) {
        if (!t.isExpression(stmt.argument)) {
          throw new Error("Only simple return expressions supported");
        }

        value = lowerExpr(stmt.argument);
      }

      block.terminator = {
        kind: "return",
        value,
      };
      terminated = true;
      return;
    }

    throw new Error(`Unsupported statement: ${stmt.type}`);
  }

  // ---- Menelusuri body ----

  if (!t.isBlockStatement(node.body)) {
    throw new Error("Expected block body");
  }

  for (const stmt of node.body.body) {
    lowerStatement(stmt);
    if (terminated) {
      break;
    }
  }

  if (!terminated) {
    // Opsional: kembalikan nilai yang terakhir ditetapkan
    const lastVal = [...env.values()].pop();
    block.terminator = {
      kind: "return",
      value: lastVal,
    };
  }

  return irFunc;
}

function formatLiteral(value: any): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (value === undefined) {
    return "undefined";
  }

  const json = JSON.stringify(value);
  return json ?? String(value);
}

function formatBlockMeta(meta?: BlockMeta): string | null {
  if (!meta) {
    return null;
  }
  const parts: string[] = [];
  if (meta.isFake) parts.push("fake");
  if (meta.flattenable) parts.push("flattenable");
  if (parts.length === 0) return null;
  return parts.join(", ");
}

export function formatIR(func: IRFunction): string {
  const blocks: string[] = [];
  for (const [id, block] of func.blocks) {
    const instrs: string[] = [];
    for (const instrId of block.instructions) {
      const instr = func.instructions.get(instrId)!;
      instrs.push(`${instrId}: ${formatInstr(instr)}`);
    }
    const term = formatTerm(block.terminator);
    const meta = formatBlockMeta(block.meta);
    blocks.push(
      `${id}${meta ? ` /* ${meta} */` : ""}\n  ${instrs.join("\n  ")}\n  ${term}`,
    );
  }
  return `function ${func.id}() {\n${blocks.join("\n\n")}\n}`;
}

function formatInstr(instr: IRInstruction): string {
  switch (instr.kind) {
    case "const":
      return `const ${instr.outputs[0]} = ${formatLiteral(instr.value)}`;
    case "binop":
      return `${instr.outputs[0]} = ${instr.left} ${instr.op} ${instr.right}`;
    case "unop":
      return `${instr.outputs[0]} = ${instr.op} ${instr.operand}`;
    case "phi":
      return `${instr.outputs[0]} = phi(${instr.inputs.join(", ")})`;
    case "load":
      return `${instr.outputs[0]} = load(${instr.address})`;
    case "store":
      return `store(${instr.address}, ${instr.value})`;
    case "call":
      return `${instr.outputs[0]} = call(${instr.callee}, ${instr.args.join(", ")})`;
    case "move":
      return `${instr.outputs[0]} = move(${instr.from})`;
    case "nop":
      return `nop`;
  }
}

function formatTerm(term: IRTerminator): string {
  switch (term.kind) {
    case "jump":
      return `jump ${term.target}`;
    case "branch":
      return `branch ${term.condition} ? ${term.then} : ${term.else}`;
    case "switch":
      return `switch ${term.discriminant}`;
    case "return":
      return `return ${term.value ?? "void"}`;
  }
}
