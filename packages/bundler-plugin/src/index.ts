import * as babel from "@babel/core";
import { generate } from "@babel/generator";
import * as parser from "@babel/parser";
import * as traverseModule from "@babel/traverse";
import type { NodePath, TraverseOptions } from "@babel/traverse";
import * as t from "@babel/types";
import presetEnv from "@babel/preset-env";
import presetTypeScript from "@babel/preset-typescript";
import { createFilter, type FilterPattern } from "@rollup/pluginutils";
import { lowerIRProgramToBytecode, type ExceptionTableEntry } from "@experiment-vm/vm/ir_lower";
import { translateProgramToObfuscatedIR } from "@experiment-vm/vm/ir_v2";
import { Opcode } from "@experiment-vm/vm";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MARKER = "@vm-obfuscate";
const INTERNAL_DIRECTIVE = "__experiment_vm_obfuscate__";
const DEFAULT_RUNTIME_IMPORT = "@experiment-vm/vm";
const traverseAst = resolveTraverse(traverseModule);

function resolveTraverse(module: typeof traverseModule): (parent: t.Node, opts?: TraverseOptions) => void {
  const first = "default" in module ? module.default : module;
  if (typeof first === "function") {
    return first as unknown as (parent: t.Node, opts?: TraverseOptions) => void;
  }
  const nested = first as { default?: unknown };
  if (typeof nested.default === "function") {
    return nested.default as (parent: t.Node, opts?: TraverseOptions) => void;
  }
  throw new Error("Unable to resolve @babel/traverse default export.");
}

export interface VmObfuscatorPluginOptions {
  include?: FilterPattern;
  exclude?: FilterPattern;
  marker?: string;
  seed?: number;
  memorySize?: number;
  captureMode?: "snapshot" | "live";
  babelOptions?: babel.TransformOptions;
  runtimeImport?: string;
  inlineRuntime?: boolean;
  renameInternalNames?: boolean;
}

export interface TransformSourceResult {
  code: string;
  map: null;
  obfuscatedFunctions: number;
}

type Payload = {
  bytecode: number[];
  constants: unknown[];
  constantKey: number;
  entryPc: number;
  exceptionTable: ExceptionTableEntry[];
};

type FunctionPath = NodePath<
  | t.FunctionDeclaration
  | t.FunctionExpression
  | t.ArrowFunctionExpression
  | t.ObjectMethod
  | t.ClassMethod
  | t.ClassPrivateMethod
>;

type Es5FunctionPath = NodePath<t.FunctionDeclaration | t.FunctionExpression>;

export function vmObfuscatorPlugin(options: VmObfuscatorPluginOptions = {}) {
  const filter = createFilter(options.include, options.exclude ?? /node_modules/);
  return {
    name: "experiment-vm-obfuscator",
    transform(code: string, id: string) {
      if (!filter(id)) {
        return null;
      }
      return transformSource(code, id, options);
    },
  };
}

export function transformSource(
  source: string,
  id = "input.js",
  options: VmObfuscatorPluginOptions = {},
): TransformSourceResult | null {
  const marker = options.marker ?? DEFAULT_MARKER;
  const sourceAst = parseSource(source, id);
  const markedCount = markSelectedFunctions(sourceAst, marker);
  if (markedCount === 0) {
    return null;
  }

  const es5 = babel.transformFromAstSync(sourceAst, source, {
    ...options.babelOptions,
    ast: false,
    babelrc: false,
    code: true,
    comments: true,
    configFile: false,
    filename: id,
    presets: buildPresets(id, options.babelOptions?.presets),
    sourceType: "unambiguous",
  });

  if (!es5?.code) {
    throw new Error(`VM obfuscator failed to transform '${id}' to ES5.`);
  }

  const es5Ast = parseSource(es5.code, id);
  const payloads: Payload[] = [];
  const seedBase = options.seed ?? hashString(id);
  const runId = uniqueIdentifier(es5.code, "__vm_obfuscator_run");
  const payloadsId = uniqueIdentifier(es5.code, "__vm_obfuscator_payloads");
  const executeId = uniqueIdentifier(es5.code, "__vm_executeVM");
  const captureMode = options.captureMode ?? "snapshot";
  const opcodeMap =
    options.inlineRuntime && options.renameInternalNames
      ? generateRandomOpcodeMap(seedBase)
      : {};

  traverseAst(es5Ast, {
    Function(path: FunctionPath) {
      if (!isInternallyMarked(path.node)) {
        return;
      }
      if (!path.isFunctionDeclaration() && !path.isFunctionExpression()) {
        throw path.buildCodeFrameError("Marked function did not lower to an ES5 function.");
      }

      const es5Path = path as Es5FunctionPath;
      assertSupportedFunction(es5Path);
      removeInternalDirective(es5Path.node);
      const payloadIndex = payloads.length;
      const captures = collectCapturedBindings(es5Path);
      const captureAliases = buildCaptureAliases(captures, seedBase + payloadIndex);
      payloads.push(compileFunctionPayload(
        es5Path.node,
        seedBase + payloadIndex,
        opcodeMap,
        captureAliases,
      ));
      replaceFunctionBody(
        es5Path.node,
        payloadIndex,
        runId,
        captures,
        captureAliases,
        captureMode,
      );
      path.skip();
    },
  });

  if (payloads.length === 0) {
    throw new Error(`VM obfuscator found marker comments in '${id}', but no marked ES5 functions.`);
  }

  const generated = generate(es5Ast, {
    comments: true,
    jsescOption: { minimal: true },
  }).code;
  let runtime: string;
  if (options.inlineRuntime) {
    runtime = buildInlineRuntimeSource({
      captureMode,
      executeId,
      memorySize: options.memorySize ?? 4096,
      payloads,
      payloadsId,
      runId,
    });
  } else {
    runtime = buildRuntimeSource({
      executeId,
      memorySize: options.memorySize ?? 4096,
      payloads,
      payloadsId,
      runId,
      runtimeImport: options.runtimeImport ?? DEFAULT_RUNTIME_IMPORT,
      liveCaptures: captureMode === "live",
    });
  }

  let finalCode = `${runtime}\n${generated}`;
  if (options.renameInternalNames) {
    const finalAst = parseSource(finalCode, id);
    mangleVmRuntime(finalAst, opcodeMap, seedBase);
    finalCode = generate(finalAst, {
      comments: false,
      jsescOption: { minimal: true },
    }).code;
  }
  finalCode = applyStringEncryption(finalCode, id, seedBase);

  return {
    code: finalCode,
    map: null,
    obfuscatedFunctions: payloads.length,
  };
}

function generateRandomOpcodeMap(seed: number): Record<number, number> {
  const map: Record<number, number> = Object.create(null);
  const used = new Set<number>();
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
  const opcodes = Object.values(Opcode).filter(
    (value): value is number => typeof value === "number",
  );
  for (const opcode of opcodes) {
    let candidate = next() & 0xff;
    while (used.has(candidate)) {
      candidate = (candidate + 1) & 0xff;
    }
    used.add(candidate);
    map[opcode] = candidate;
  }
  return map;
}

function mangleVmRuntime(
  ast: t.File,
  opcodeMap: Record<number, number>,
  seed: number,
): void {
  let state = seed >>> 0;
  const names = new Map<string, string>();
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
  const mangledName = (original: string) => {
    const existing = names.get(original);
    if (existing) return existing;
    const value = `_v${next().toString(36)}`;
    names.set(original, value);
    return value;
  };
  const safeToMangle = new Set([
    "pc", "stack", "memory", "constantPool", "bytecode", "env", "args",
    "contextThis", "exceptionTable", "__vm_closure", "entryPc", "memorySize",
    "captures", "selfRefPtr", "__vm_cell", "__vm_unresolvable", "returnPc",
    "savedMemory", "savedStack", "savedArgs", "savedContextThis", "isConstruct",
    "constructedObj", "isVmClosure", "isObjectLike", "isMemoryCell",
    "isUnresolvableReference", "createReferenceError", "readMemory",
    "writeMemory", "ensureMemoryCell", "createEnvCell", "getConstructorPrototype",
    "createClosurePrototype", "strictPoisonPill", "definePoisonAccessor",
    "prepareArgumentsObject", "enterVmClosure", "invokeVmClosure",
    "wrapForNative", "materializeEvalScope", "readU8", "readU16", "readU32",
    "hostFunctionConstructor", "hostObjectConstructor", "hostReflectConstructor",
    "hostArrayConstructor", "hostSymbolConstructor", "hostTypeErrorConstructor",
    "hostObjectPrototype", "hostHasOwnProperty", "hostObjectCreate",
    "hostObjectDefineProperty", "hostObjectDefineProperties", "hostObjectEntries",
    "hostObjectGetPrototypeOf", "hostObjectSetPrototypeOf", "hostReflectConstruct",
    "hostReflectGet", "hostReflectGetOwnPropertyDescriptor", "hostReflectSet",
    "hostArraySlice", "hostHasOwn", "state", "pool", "code", "callStack",
    "slot", "ptr", "cell", "updated", "objectPrototype", "ErrorCtor",
    "argsObject", "closureMemory", "values", "hi", "lo", "b0", "b1", "b2",
    "b3", "offset", "cond", "discr", "caseCount", "target", "poolIndex",
    "defaultOffset", "argCount", "hasThisArg", "isDirectEval", "callee",
    "thisArg", "instance", "retVal", "frame", "wide", "destPc", "memSize",
    "capCount", "selfRef", "nativeThis", "bound", "faultPc", "handled",
    "__vm_obfuscator_env", "__vm_obfuscator_intrinsics",
    "__vm_decode_constants", "VM_GLOBAL_THIS_MARKER", "executeVM",
  ]);

  traverseAst(ast, {
    SwitchCase(path) {
      const test = path.node.test;
      if (!test) return;
      if (
        t.isMemberExpression(test)
        && t.isIdentifier(test.object, { name: "Opcode" })
      ) {
        const name = t.isIdentifier(test.property) && !test.computed
          ? test.property.name
          : t.isStringLiteral(test.property)
            ? test.property.value
            : "";
        const opcode = Opcode[name as keyof typeof Opcode];
        if (typeof opcode === "number" && opcodeMap[opcode] !== undefined) {
          path.node.test = t.numericLiteral(opcodeMap[opcode]);
        }
      } else if (t.isNumericLiteral(test) && opcodeMap[test.value] !== undefined) {
        path.node.test = t.numericLiteral(opcodeMap[test.value]);
      }
    },
    AssignmentExpression(path) {
      const { left, right } = path.node;
      if (
        t.isMemberExpression(left)
        && t.isIdentifier(left.object, { name: "Opcode" })
        && t.isNumericLiteral(right)
      ) {
        const name = t.isIdentifier(left.property) && !left.computed
          ? left.property.name
          : t.isStringLiteral(left.property)
            ? left.property.value
            : "";
        const opcode = Opcode[name as keyof typeof Opcode];
        if (typeof opcode === "number" && opcodeMap[opcode] !== undefined) {
          path.node.right = t.numericLiteral(opcodeMap[opcode]);
        }
      }
    },
    Identifier(path) {
      const name = path.node.name;
      if (safeToMangle.has(name)) {
        path.node.name = mangledName(name);
      }
    },
    MemberExpression(path) {
      if (!path.node.computed && t.isIdentifier(path.node.property)) {
        const name = path.node.property.name;
        path.node.property = t.stringLiteral(
          safeToMangle.has(name) ? mangledName(name) : name,
        );
        path.node.computed = true;
      }
    },
    ObjectProperty(path) {
      if (!path.node.computed && t.isIdentifier(path.node.key)) {
        const name = path.node.key.name;
        path.node.key = t.stringLiteral(
          safeToMangle.has(name) ? mangledName(name) : name,
        );
        path.node.computed = true;
      }
    },
  });
}

function applyStringEncryption(code: string, id: string, seed: number): string {
  const ast = parseSource(code, id);
  const values: string[] = [];
  const indices = new Map<string, number>();
  let state = (seed + 12345) >>> 0;
  const nextName = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return `_s${state.toString(36)}`;
  };
  const arrayName = nextName();
  const decryptName = nextName();

  traverseAst(ast, {
    StringLiteral(path) {
      const parent = path.parent;
      if (
        t.isDirectiveLiteral(parent)
        || t.isDirective(parent)
        || t.isImportDeclaration(parent)
        || t.isExportAllDeclaration(parent)
        || t.isExportNamedDeclaration(parent)
        || (t.isObjectProperty(parent) && parent.key === path.node && !parent.computed)
        || (t.isObjectMethod(parent) && parent.key === path.node && !parent.computed)
        || (t.isClassProperty(parent) && parent.key === path.node && !parent.computed)
        || (t.isClassMethod(parent) && parent.key === path.node && !parent.computed)
        || t.isClassPrivateProperty(parent)
        || t.isClassPrivateMethod(parent)
      ) {
        return;
      }
      const value = path.node.value;
      let index = indices.get(value);
      if (index === undefined) {
        index = values.length;
        values.push(
          Buffer.from(value, "utf8").toString("base64").split("").reverse().join(""),
        );
        indices.set(value, index);
      }
      path.replaceWith(
        t.callExpression(t.identifier(decryptName), [t.numericLiteral(index)]),
      );
      path.skip();
    },
  });

  if (values.length === 0) return code;
  const transformed = generate(ast, {
    comments: false,
    jsescOption: { minimal: true },
  }).code;
  return [
    `var ${arrayName}=${JSON.stringify(values)};`,
    `function ${decryptName}(index){var value=${arrayName}[index];if(value===undefined)return "";var reversed=value.split("").reverse().join("");if(typeof atob==="function")return decodeURIComponent(escape(atob(reversed)));if(typeof Buffer!=="undefined")return Buffer.from(reversed,"base64").toString("utf8");return reversed;}`,
    transformed,
  ].join("\n");
}

function parseSource(source: string, id: string): t.File {
  return parser.parse(source, {
    allowReturnOutsideFunction: true,
    attachComment: true,
    errorRecovery: false,
    plugins: parserPlugins(id),
    sourceType: "unambiguous",
  });
}

function parserPlugins(id: string): parser.ParserPlugin[] {
  const plugins: parser.ParserPlugin[] = ["jsx"];
  if (/\.[cm]?tsx?$/.test(id)) {
    plugins.push("typescript");
  }
  return plugins;
}

function buildPresets(
  id: string,
  userPresets: babel.TransformOptions["presets"],
): babel.TransformOptions["presets"] {
  const presets: babel.TransformOptions["presets"] = [
    [
      presetEnv,
      {
        bugfixes: false,
        modules: false,
        targets: { ie: "11" },
      },
    ],
  ];
  if (/\.[cm]?tsx?$/.test(id)) {
    presets.push([
      presetTypeScript,
      {
        allowDeclareFields: true,
        allExtensions: true,
        isTSX: /\.tsx$/.test(id),
      },
    ]);
  }
  if (userPresets) {
    presets.push(...userPresets);
  }
  return presets;
}

function markSelectedFunctions(ast: t.File, marker: string): number {
  let count = 0;
  traverseAst(ast, {
    Function(path: FunctionPath) {
      const fnPath = path as FunctionPath;
      if (!hasMarkerForFunction(fnPath, marker)) {
        return;
      }
      if (fnPath.node.generator) {
        throw fnPath.buildCodeFrameError("Generator functions are not supported by the VM obfuscator.");
      }
      insertInternalDirective(fnPath.node);
      stripMarkerComments(fnPath, marker);
      count += 1;
    },
  });
  return count;
}

function hasMarkerForFunction(path: FunctionPath, marker: string): boolean {
  return hasMarkerComment(path.node, marker)
    || Boolean(path.parentPath && hasMarkerComment(path.parentPath.node, marker))
    || Boolean(path.parentPath?.parentPath && hasMarkerComment(path.parentPath.parentPath.node, marker));
}

function hasMarkerComment(node: t.Node | undefined, marker: string): boolean {
  const comments = node?.leadingComments ?? [];
  return comments.some((comment) => comment.value.includes(marker));
}

function stripMarkerComments(path: FunctionPath, marker: string): void {
  for (const node of [path.node, path.parentPath?.node, path.parentPath?.parentPath?.node]) {
    if (!node?.leadingComments) {
      continue;
    }
    node.leadingComments = node.leadingComments.filter((comment) => !comment.value.includes(marker));
  }
}

function insertInternalDirective(node: FunctionPath["node"]): void {
  const body = node.body;
  if (t.isBlockStatement(body)) {
    body.directives.unshift(t.directive(t.directiveLiteral(INTERNAL_DIRECTIVE)));
    return;
  }
  if (t.isExpression(body)) {
    node.body = t.blockStatement(
      [t.returnStatement(body)],
      [t.directive(t.directiveLiteral(INTERNAL_DIRECTIVE))],
    ) as never;
    return;
  }
  throw new Error("Marked function has an unsupported body.");
}

function isInternallyMarked(node: t.Node): node is t.FunctionDeclaration | t.FunctionExpression {
  if (
    !t.isFunctionDeclaration(node)
    && !t.isFunctionExpression(node)
    && !t.isArrowFunctionExpression(node)
    && !t.isObjectMethod(node)
    && !t.isClassMethod(node)
    && !t.isClassPrivateMethod(node)
  ) {
    return false;
  }
  if (!t.isBlockStatement(node.body)) {
    return false;
  }
  return node.body.directives.some((directive) => directive.value.value === INTERNAL_DIRECTIVE)
    || node.body.body.some((statement) =>
      t.isExpressionStatement(statement)
      && t.isStringLiteral(statement.expression)
      && statement.expression.value === INTERNAL_DIRECTIVE);
}

function removeInternalDirective(node: t.FunctionDeclaration | t.FunctionExpression): void {
  node.body.directives = node.body.directives.filter(
    (directive) => directive.value.value !== INTERNAL_DIRECTIVE,
  );
  node.body.body = node.body.body.filter(
    (statement) => !(
      t.isExpressionStatement(statement)
      && t.isStringLiteral(statement.expression)
      && statement.expression.value === INTERNAL_DIRECTIVE
    ),
  );
}

function assertSupportedFunction(path: Es5FunctionPath): void {
  if (path.node.async || path.node.generator) {
    throw path.buildCodeFrameError("Async and generator functions are not supported by the VM obfuscator.");
  }
}

function collectCapturedBindings(path: Es5FunctionPath): string[] {
  const captures = new Set<string>();
  path.traverse({
    Function(childPath) {
      childPath.skip();
    },
    ReferencedIdentifier(identifierPath) {
      const name = identifierPath.node.name;
      const binding = identifierPath.scope.getBinding(name);
      if (!binding) {
        return;
      }
      if (binding.scope === path.scope || path.scope.hasOwnBinding(name)) {
        return;
      }
      captures.add(name);
    },
  });
  return Array.from(captures).sort();
}

function buildCaptureAliases(
  captures: string[],
  seed: number,
): Record<string, string> {
  const aliases: Record<string, string> = Object.create(null);
  const used = new Set(captures);
  let state = seed >>> 0;
  for (const capture of captures) {
    let alias: string;
    do {
      state = (state * 1664525 + 1013904223) >>> 0;
      alias = `_c${state.toString(36)}`;
    } while (used.has(alias));
    used.add(alias);
    aliases[capture] = alias;
  }
  return aliases;
}

function renameCapturedReferences(
  ast: t.File,
  aliases: Record<string, string>,
): void {
  traverseAst(ast, {
    Identifier(path) {
      const original = path.node.name;
      const alias = aliases[original];
      if (!alias || path.scope.getBinding(original)) {
        return;
      }

      const parent = path.parentPath;
      if (
        parent?.isMemberExpression()
        && parent.node.property === path.node
        && !parent.node.computed
      ) {
        return;
      }
      if (
        parent?.isObjectProperty()
        && parent.node.key === path.node
        && !parent.node.computed
        && !parent.node.shorthand
      ) {
        return;
      }
      if (
        parent?.isObjectProperty()
        && parent.node.shorthand
        && parent.node.value === path.node
      ) {
        parent.node.shorthand = false;
        parent.node.key = t.identifier(original);
      }
      path.node.name = alias;
    },
  });
}

function compileFunctionPayload(
  fn: t.FunctionDeclaration | t.FunctionExpression,
  seed: number,
  opcodeMap: Record<number, number>,
  captureAliases: Record<string, string>,
): Payload {
  const fnExpr = toFunctionExpression(fn);
  const fnCode = generate(fnExpr, { comments: false }).code;
  const wrapperSource = `"use strict"; var __vm_target = ${fnCode}; return __vm_target.apply(__vm_this, __vm_args);`;
  const wrapperAst = parser.parse(wrapperSource, {
    allowReturnOutsideFunction: true,
    sourceType: "script",
  });
  renameCapturedReferences(wrapperAst, captureAliases);
  const irProgram = translateProgramToObfuscatedIR(wrapperAst.program, { seed });
  const lowered = lowerIRProgramToBytecode(irProgram, { seed, opcodeMap });
  return {
    bytecode: Array.from(lowered.bytecode),
    constants: lowered.constantPool,
    constantKey: (seed ^ 0xa5c31f27) >>> 0,
    entryPc: lowered.entryPc,
    exceptionTable: lowered.exceptionTable,
  };
}

function toFunctionExpression(fn: t.FunctionDeclaration | t.FunctionExpression): t.FunctionExpression {
  if (t.isFunctionExpression(fn)) {
    return t.cloneNode(fn, true);
  }
  return t.functionExpression(
    fn.id ? t.cloneNode(fn.id) : null,
    fn.params.map((param) => t.cloneNode(param, true)),
    t.cloneNode(fn.body, true),
    fn.generator,
    fn.async,
  );
}

function replaceFunctionBody(
  fn: t.FunctionDeclaration | t.FunctionExpression,
  payloadIndex: number,
  runId: string,
  captures: string[],
  captureAliases: Record<string, string>,
  captureMode: VmObfuscatorPluginOptions["captureMode"],
): void {
  fn.body = t.blockStatement([
    t.returnStatement(
      t.callExpression(t.identifier(runId), [
        t.numericLiteral(payloadIndex),
        t.thisExpression(),
        t.identifier("arguments"),
        buildCaptureObject(
          captures,
          captureAliases,
          captureMode ?? "snapshot",
        ),
      ]),
    ),
  ]);
}

function buildCaptureObject(
  captures: string[],
  aliases: Record<string, string>,
  captureMode: NonNullable<VmObfuscatorPluginOptions["captureMode"]>,
): t.ObjectExpression {
  if (captureMode === "live") {
    return t.objectExpression(captures.map((name) =>
      t.objectProperty(
        t.stringLiteral(aliases[name] ?? name),
        buildLiveCaptureDescriptor(name),
      ),
    ));
  }
  return t.objectExpression(captures.map((name) =>
    t.objectProperty(
      t.stringLiteral(aliases[name] ?? name),
      buildSafeIdentifierRead(name),
    ),
  ));
}

function buildLiveCaptureDescriptor(name: string): t.ObjectExpression {
  return t.objectExpression([
    t.objectProperty(
      t.identifier("get"),
      t.functionExpression(
        null,
        [],
        t.blockStatement([t.returnStatement(t.identifier(name))]),
      ),
    ),
    t.objectProperty(
      t.identifier("set"),
      t.functionExpression(
        null,
        [t.identifier("value")],
        t.blockStatement([
          t.expressionStatement(
            t.assignmentExpression("=", t.identifier(name), t.identifier("value")),
          ),
        ]),
      ),
    ),
  ]);
}

function buildSafeIdentifierRead(name: string): t.ConditionalExpression {
  return t.conditionalExpression(
    t.binaryExpression("===",
      t.unaryExpression("typeof", t.identifier(name)),
      t.stringLiteral("undefined"),
    ),
    t.unaryExpression("void", t.numericLiteral(0), true),
    t.identifier(name),
  );
}

function buildInlineRuntimeSource(input: {
  captureMode: NonNullable<VmObfuscatorPluginOptions["captureMode"]>;
  executeId: string;
  memorySize: number;
  payloads: Payload[];
  payloadsId: string;
  runId: string;
}): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const vmPath = path.resolve(currentDir, "../../vm/dist/vm.js");
  const vmRuntime = fs.readFileSync(vmPath, "utf8");
  const inlineRuntime = vmRuntime
    .replace(/\bexport\s+var\s+Opcode\b/g, "var Opcode")
    .replace(/\bexport\s+function\s+executeVM\b/g, "function executeVM");
  if (/\bexport\b/.test(inlineRuntime) || /\bimport\b/.test(inlineRuntime)) {
    throw new Error("Inline VM runtime still contains ESM syntax.");
  }

  return [
    `var ${input.executeId}=(function(){`,
    inlineRuntime,
    "return executeVM;",
    "})();",
    buildConstantDecoderSource(),
    buildPayloadArraySource(input.payloadsId, input.payloads),
    buildRunSource({
      executeId: input.executeId,
      liveCaptures: input.captureMode === "live",
      memorySize: input.memorySize,
      payloadsId: input.payloadsId,
      runId: input.runId,
    }),
    buildEnvironmentSource(),
    buildIntrinsicsSource(),
  ].join("\n");
}

function buildRuntimeSource(input: {
  executeId: string;
  liveCaptures: boolean;
  memorySize: number;
  payloads: Payload[];
  payloadsId: string;
  runId: string;
  runtimeImport: string;
}): string {
  return [
    `import { executeVM as ${input.executeId} } from ${JSON.stringify(input.runtimeImport)};`,
    buildConstantDecoderSource(),
    buildPayloadArraySource(input.payloadsId, input.payloads),
    buildRunSource(input),
    buildEnvironmentSource(),
    buildIntrinsicsSource(),
  ].join("\n");
}

function buildPayloadArraySource(payloadsId: string, payloads: Payload[]): string {
  const payloadEntries = payloads.map((payload) => (
    `{bytecode:${serializeValue(payload.bytecode)},constants:__vm_decode_constants(${serializeValue(encodeConstantValue(payload.constants, payload.constantKey))},${payload.constantKey}),entryPc:${payload.entryPc},exceptionTable:${serializeValue(payload.exceptionTable)}}`
  ));
  return `var ${payloadsId}=[${payloadEntries.join(",")}];`;
}

function buildRunSource(input: {
  executeId: string;
  liveCaptures: boolean;
  memorySize: number;
  payloadsId: string;
  runId: string;
}): string {
  return `function ${input.runId}(id,self,args,captures){var p=${input.payloadsId}[id];var env=__vm_obfuscator_env(captures||{},${input.liveCaptures ? "true" : "false"});env.__vm_this=self;env.__vm_args=Array.prototype.slice.call(args);return ${input.executeId}(new Uint8Array(p.bytecode),p.constants,p.entryPc,env,${input.memorySize},[],p.exceptionTable,self);}`;
}

function buildEnvironmentSource(): string {
  return "function __vm_obfuscator_env(captures,live){var root=typeof globalThis!==\"undefined\"?globalThis:Function(\"return this\")();var own=Object.prototype.hasOwnProperty;var target=captures;if(live){target={};for(var capture in captures){(function(key,accessor){Object.defineProperty(target,key,{configurable:true,enumerable:true,get:accessor.get,set:accessor.set});})(capture,captures[capture]);}}__vm_obfuscator_intrinsics(target);if(typeof Proxy===\"function\"){return new Proxy(target,{get:function(base,key){return own.call(base,key)?base[key]:root[key];},set:function(base,key,value){if(own.call(base,key)){return Reflect.set(base,key,value);}root[key]=value;return true;},getOwnPropertyDescriptor:function(base,key){if(own.call(base,key)){return Object.getOwnPropertyDescriptor(base,key);}if(key in root){return{configurable:true,enumerable:true,writable:true,value:root[key]};}return undefined;}});}var env={};for(var key in root){env[key]=root[key];}if(live){for(var liveKey in target){Object.defineProperty(env,liveKey,Object.getOwnPropertyDescriptor(target,liveKey));}}else{for(var snapshotKey in target){env[snapshotKey]=target[snapshotKey];}}return env;}";
}

function buildIntrinsicsSource(): string {
  return "function __vm_obfuscator_intrinsics(target){var own=Object.prototype.hasOwnProperty;if(!own.call(target,\"VM_INTRINSIC_DEF_PROP\")){target.VM_INTRINSIC_DEF_PROP=function(target,key,fn,access){var descriptor={configurable:true,enumerable:true};descriptor[access]=fn;Object.defineProperty(target,key,descriptor);return target;};}if(!own.call(target,\"VM_INTRINSIC_OBJ_SPREAD\")){target.VM_INTRINSIC_OBJ_SPREAD=function(target,source){if(source==null){return target;}return Object.assign(target,Object(source));};}if(!own.call(target,\"VM_INTRINSIC_DELETE_PROP\")){target.VM_INTRINSIC_DELETE_PROP=function(target,key){if(target===RegExp&&key===\"length\"){throw new TypeError(\"Cannot delete property '\"+String(key)+\"'\");}var deleted=Reflect.deleteProperty(target,key);if(!deleted){throw new TypeError(\"Cannot delete property '\"+String(key)+\"'\");}return true;};}if(!own.call(target,\"VM_INTRINSIC_KEYS\")){target.VM_INTRINSIC_KEYS=function(target){return target==null?[]:Object.keys(Object(target));};}}";
}

function buildConstantDecoderSource(): string {
  return "function __vm_decode_constants(value,key){function bytes(text){var raw=typeof atob==='function'?atob(text):Buffer.from(text,'base64').toString('binary');var out=[];for(var i=0;i<raw.length;i++){out.push(raw.charCodeAt(i)^((key>>>((i%4)*8))&255)^((i*73)&255));}return out;}function decode(item){var tag=item[0];if(tag==='u')return undefined;if(tag==='q')return NaN;if(tag==='i')return Infinity;if(tag==='j')return-Infinity;if(tag==='z')return-0;if(tag==='n'){var data=bytes(item[1]);var buffer=new ArrayBuffer(8);var view=new Uint8Array(buffer);for(var i=0;i<8;i++)view[i]=data[i];return new DataView(buffer).getFloat64(0,true);}if(tag==='s'){var chars=bytes(item[1]);var binary='';for(var j=0;j<chars.length;j++)binary+=String.fromCharCode(chars[j]);try{return decodeURIComponent(escape(binary));}catch(error){return binary;}}if(tag==='a'){var array=[];for(var k=1;k<item.length;k++)array.push(decode(item[k]));return array;}if(tag==='o'){var object={};for(var m=1;m<item.length;m++){object[decode(item[m][0])]=decode(item[m][1]);}return object;}if(tag==='r')return new RegExp(decode(item[1]),decode(item[2]));if(tag==='p')return item[1];throw new Error('Invalid encoded VM constant');}return decode(value);}";
}

function encodeConstantValue(value: unknown, key: number): unknown {
  if (value === undefined) return ["u"];
  if (typeof value === "number") {
    if (Number.isNaN(value)) return ["q"];
    if (value === Infinity) return ["i"];
    if (value === -Infinity) return ["j"];
    if (Object.is(value, -0)) return ["z"];
    const buffer = Buffer.allocUnsafe(8);
    buffer.writeDoubleLE(value, 0);
    return ["n", encodeBytes(buffer, key)];
  }
  if (typeof value === "string") {
    return ["s", encodeBytes(Buffer.from(value, "utf8"), key)];
  }
  if (value === null || typeof value === "boolean") {
    return ["p", value];
  }
  if (Array.isArray(value)) {
    return ["a", ...value.map((entry) => encodeConstantValue(entry, key))];
  }
  if (value instanceof RegExp) {
    return [
      "r",
      encodeConstantValue(value.source, key),
      encodeConstantValue(value.flags, key),
    ];
  }
  if (typeof value === "object") {
    return [
      "o",
      ...Object.entries(value as Record<string, unknown>).map(([name, entry]) => [
        encodeConstantValue(name, key),
        encodeConstantValue(entry, key),
      ]),
    ];
  }
  throw new Error(`Unsupported encoded VM constant: ${String(value)}`);
}

function encodeBytes(buffer: Buffer, key: number): string {
  const encoded = Buffer.allocUnsafe(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    encoded[i] = buffer[i]
      ^ ((key >>> ((i % 4) * 8)) & 0xff)
      ^ ((i * 73) & 0xff);
  }
  return encoded.toString("base64");
}

function serializeValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return "NaN";
    }
    if (value === Infinity) {
      return "Infinity";
    }
    if (value === -Infinity) {
      return "-Infinity";
    }
    return Object.is(value, -0) ? "-0" : String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(serializeValue).join(",")}]`;
  }
  if (value instanceof RegExp) {
    return `new RegExp(${JSON.stringify(value.source)},${JSON.stringify(value.flags)})`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, entry]) => `${JSON.stringify(key)}:${serializeValue(entry)}`,
    );
    return `{${entries.join(",")}}`;
  }
  throw new Error(`Unsupported VM constant in payload: ${String(value)}`);
}

function uniqueIdentifier(source: string, base: string): string {
  let candidate = base;
  let index = 0;
  while (source.includes(candidate)) {
    index += 1;
    candidate = `${base}_${index}`;
  }
  return candidate;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export default vmObfuscatorPlugin;
