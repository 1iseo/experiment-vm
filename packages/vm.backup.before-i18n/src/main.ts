import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from "@babel/types";
import { prettyPrintIRFunction, translateFunctionToObfuscatedIR } from "./ir_v2.js";
const traverse = _traverse.default;


const code = `
  function main(a, b) {
    return a + b * 2;
  }
`

const unaryCode = `
  function unaryDemo(a) {
    const x = void a;
    return delete a;
  }
`;

const callCode = `
  function callDemo(a) {
    return a(3);
  }
`;

const parseResult = parser.parse(code, {
  sourceType: 'module',
});

const unaryParseResult = parser.parse(unaryCode, {
  sourceType: 'script',
});

const callParseResult = parser.parse(callCode, {
  sourceType: 'module',
});

const result = eval(code);
console.log(result);

// Print out the AST
console.log(JSON.stringify(parseResult, null, 5));

traverse(parseResult, {
  enter(path) {
    console.log('Visiting node type:', path.node.type);
    if (t.isBinaryExpression(path.node)) {
      console.log('Found a binary expression:', path.node.operator); 
    }
  }
});

function compileToVM(ast: t.Node): VM_Instruction[] {
  const instructions: VM_Instruction[] = [];

  function compile(node: t.Node | null | undefined) {
    if (!node) return;

    if (t.isFile(node)) {
      compile(node.program);
      return;
    }

    if (t.isProgram(node)) {
      for (const stmt of node.body) compile(stmt as unknown as t.Node);
      return;
    }

    if (t.isExpressionStatement(node)) {
      compile(node.expression as unknown as t.Node);
      return;
    }

    if (t.isNumericLiteral(node)) {
      instructions.push({ type: 'PUSH', value: node.value });
      return;
    }

    if (t.isBinaryExpression(node)) {
      // compile left then right, then emit operator
      compile(node.left as unknown as t.Node);
      compile(node.right as unknown as t.Node);

      switch (node.operator) {
        case '+':
          instructions.push({ type: 'ADD' });
          break;
        case '-':
          instructions.push({ type: 'SUB' });
          break;
        case '*':
          instructions.push({ type: 'MUL' });
          break;
        case '/':
          instructions.push({ type: 'DIV' });
          break;
        default:
          throw new Error(`Unsupported binary operator: ${node.operator}`);
      }

      return;
    }

    // For now, ignore other node types (identifiers, calls, etc.)
  }

  compile(ast);
  return instructions;
}

type VM_Instruction = {
  type: 'PUSH' | 'POP' | 'ADD' | 'SUB' | 'MUL' | 'DIV';
  value?: any;
}

type VM = {
  pc: number;
  stack: any[];
  code: VM_Instruction[];
}

function execute(vm: VM) {
  while (vm.pc < vm.code.length) {
    const instr = vm.code[vm.pc];
    switch (instr.type) {
      case 'PUSH':
        vm.stack.push(instr.value);
        break;
      case 'ADD': {
        const b = vm.stack.pop();
        const a = vm.stack.pop();
        vm.stack.push(a + b);
        break;
      }
      // Handle other instructions (SUB, MUL, DIV) similarly
    }
    vm.pc++;
  }
}


const instructions = compileToVM(parseResult);
console.log('Compiled instructions:', instructions);
const vm: VM = { pc: 0, stack: [], code: instructions };
execute(vm);
console.log('Final VM stack:', vm.stack);

type SSAOp = 'const' | 'param' | 'add' | 'sub' | 'mul' | 'div' | 'ret';

type SSAInstruction = {
  id?: number;
  op: SSAOp;
  args: number[];
  value?: number;
  name?: string;
}

type SSABlock = {
  id: number;
  instructions: SSAInstruction[];
}

type SSAFunction = {
  name: string;
  params: string[];
  entry: number;
  blocks: SSABlock[];
}

function prettyPrintSSA(fn: SSAFunction) {
  const lines: string[] = [];
  const fmtValue = (id: number) => `%${id}`;

  lines.push(`function ${fn.name}(${fn.params.join(', ')}):`);
  lines.push(`entry: block${fn.entry}`);

  for (const block of fn.blocks) {
    lines.push(`block${block.id}:`);
    for (const instr of block.instructions) {
      if (instr.op === 'ret') {
        lines.push(`  ret ${fmtValue(instr.args[0])}`);
        continue;
      }

      const id = instr.id ?? 0;
      if (instr.op === 'param') {
        lines.push(`  ${fmtValue(id)} = param ${instr.name ?? 'unnamed'}`);
        continue;
      }

      if (instr.op === 'const') {
        lines.push(`  ${fmtValue(id)} = const ${instr.value}`);
        continue;
      }

      if (instr.args.length === 2) {
        lines.push(
          `  ${fmtValue(id)} = ${instr.op} ${fmtValue(instr.args[0])}, ${fmtValue(instr.args[1])}`
        );
        continue;
      }

      lines.push(`  ${fmtValue(id)} = ${instr.op} ${instr.args.map(fmtValue).join(', ')}`);
    }
  }

  return lines.join('\n');
}

function executeSSA(fn: SSAFunction, args: number[]) {
  const paramIndex = new Map<string, number>();
  for (let i = 0; i < fn.params.length; i++) {
    paramIndex.set(fn.params[i], i);
  }

  const values = new Map<number, number>();

  const entry = fn.blocks.find((block) => block.id === fn.entry);
  if (!entry) throw new Error(`Missing entry block ${fn.entry}`);

  for (const instr of entry.instructions) {
    switch (instr.op) {
      case 'param': {
        const idx = paramIndex.get(instr.name ?? '');
        if (idx === undefined) throw new Error(`Unknown param: ${instr.name}`);
        const value = args[idx];
        if (value === undefined) {
          throw new Error(`Missing argument for param ${instr.name}`);
        }
        if (!instr.id) throw new Error('Param instruction missing id');
        values.set(instr.id, value);
        break;
      }
      case 'const': {
        if (!instr.id) throw new Error('Const instruction missing id');
        values.set(instr.id, instr.value ?? 0);
        break;
      }
      case 'add':
      case 'sub':
      case 'mul':
      case 'div': {
        if (!instr.id) throw new Error('Binary instruction missing id');
        const left = values.get(instr.args[0]);
        const right = values.get(instr.args[1]);
        if (left === undefined || right === undefined) {
          throw new Error(`Missing SSA operands for ${instr.op}`);
        }

        let result = 0;
        switch (instr.op) {
          case 'add':
            result = left + right;
            break;
          case 'sub':
            result = left - right;
            break;
          case 'mul':
            result = left * right;
            break;
          case 'div':
            result = left / right;
            break;
        }

        values.set(instr.id, result);
        break;
      }
      case 'ret': {
        const value = values.get(instr.args[0]);
        if (value === undefined) throw new Error('Missing SSA return value');
        return value;
      }
    }
  }

  throw new Error('SSA function did not return');
}

class SSABuilder {
  private nextValueId = 1;
  private nextBlockId = 1;
  private blocks: SSABlock[] = [];
  private current: SSABlock;

  constructor(private readonly name: string) {
    this.current = this.createBlock();
  }

  private createBlock() {
    const block: SSABlock = { id: this.nextBlockId++, instructions: [] };
    this.blocks.push(block);
    return block;
  }

  emit(op: SSAOp, args: number[], data?: { value?: number; name?: string }) {
    const instr: SSAInstruction = { op, args, ...data };
    if (op !== 'ret') {
      instr.id = this.nextValueId++;
    }
    this.current.instructions.push(instr);
    return instr.id ?? -1;
  }

  finish(params: string[]) {
    return {
      name: this.name,
      params,
      entry: this.blocks[0].id,
      blocks: this.blocks,
    } satisfies SSAFunction;
  }
}

function compileToSSA(ast: t.File): SSAFunction {
  if (!t.isFile(ast)) throw new Error('Expected Babel File node');

  const funcNode = ast.program.body.find((node): node is t.FunctionDeclaration =>
    t.isFunctionDeclaration(node)
  );

  if (!funcNode || !funcNode.id) {
    throw new Error('Expected a single function declaration');
  }

  const builder = new SSABuilder(funcNode.id.name);
  const params: string[] = [];
  const env = new Map<string, number>();

  for (const param of funcNode.params) {
    if (!t.isIdentifier(param)) {
      throw new Error('Only identifier params are supported');
    }

    params.push(param.name);
    const id = builder.emit('param', [], { name: param.name });
    env.set(param.name, id);
  }

  function compileExpr(node: t.Expression): number {
    if (t.isNumericLiteral(node)) {
      return builder.emit('const', [], { value: node.value });
    }

    if (t.isIdentifier(node)) {
      const id = env.get(node.name);
      if (!id) throw new Error(`Unknown identifier: ${node.name}`);
      return id;
    }

    if (t.isBinaryExpression(node)) {
      const left = compileExpr(node.left as t.Expression);
      const right = compileExpr(node.right as t.Expression);

      switch (node.operator) {
        case '+':
          return builder.emit('add', [left, right]);
        case '-':
          return builder.emit('sub', [left, right]);
        case '*':
          return builder.emit('mul', [left, right]);
        case '/':
          return builder.emit('div', [left, right]);
        default:
          throw new Error(`Unsupported binary operator: ${node.operator}`);
      }
    }

    throw new Error(`Unsupported expression: ${node.type}`);
  }

  let returned = false;
  for (const stmt of funcNode.body.body) {
    if (t.isReturnStatement(stmt)) {
      if (!stmt.argument || !t.isExpression(stmt.argument)) {
        throw new Error('Return must be an expression');
      }

      const valueId = compileExpr(stmt.argument);
      builder.emit('ret', [valueId]);
      returned = true;
      break;
    }

    if (t.isExpressionStatement(stmt)) {
      if (!t.isExpression(stmt.expression)) {
        throw new Error('Expression statement is not an expression');
      }
      compileExpr(stmt.expression);
      continue;
    }

    throw new Error(`Unsupported statement: ${stmt.type}`);
  }

  if (!returned) throw new Error('Function must have a return');

  return builder.finish(params);
}

const ssa = compileToSSA(parseResult);
console.log(prettyPrintSSA(ssa));
const ssaResult = executeSSA(ssa, [3, 4]);
console.log('SSA result (a=3, b=4):', ssaResult);

const obfuscatedFn = parseResult.program.body.find(
  (node): node is t.FunctionDeclaration => t.isFunctionDeclaration(node)
);

if (!obfuscatedFn) {
  throw new Error('Expected a FunctionDeclaration in sample code');
}

const obfuscatedIR = translateFunctionToObfuscatedIR(obfuscatedFn);
console.log('Obfuscation-first IR:');
console.log(prettyPrintIRFunction(obfuscatedIR));

const unaryFn = unaryParseResult.program.body.find(
  (node): node is t.FunctionDeclaration => t.isFunctionDeclaration(node)
);

if (!unaryFn) {
  throw new Error('Expected a FunctionDeclaration in unary sample code');
}

const unaryIR = translateFunctionToObfuscatedIR(unaryFn);
console.log('Unary sample IR:');
console.log(prettyPrintIRFunction(unaryIR));

const callFn = callParseResult.program.body.find(
  (node): node is t.FunctionDeclaration =>
    t.isFunctionDeclaration(node) && node.id?.name === 'callDemo'
);

if (!callFn) {
  throw new Error('Expected callDemo in call sample code');
}

const callIR = translateFunctionToObfuscatedIR(callFn);
console.log('Call sample IR:');
console.log(prettyPrintIRFunction(callIR));