#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MARKER = "@vm-obfuscate";
const DEFAULT_FUNCTIONS = ["identity"];
const DEFAULT_ENTRY = "lodash.js";
const DEFAULT_TEST_COMMAND = "npm test";
const VM_GLOBAL = "__experimentVmExecuteVM";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const pluginRequire = createRequire(
  path.join(repoRoot, "packages", "bundler-plugin", "package.json"),
);
const parser = pluginRequire("@babel/parser");
const traverseModule = pluginRequire("@babel/traverse");
const traverse = typeof traverseModule === "function"
  ? traverseModule
  : traverseModule.default;

main().catch((error) => {
  console.error(`\n[lodash-integration] ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const lodashDir = path.resolve(
    args["lodash-dir"] ?? process.env.LODASH_DIR ?? "",
  );

  if (!lodashDir || lodashDir === path.parse(lodashDir).root) {
    throw new Error("Set LODASH_DIR or pass --lodash-dir <path>.");
  }

  await assertLodashCheckout(lodashDir);
  const bundlerDist = path.join(repoRoot, "packages", "bundler-plugin", "dist", "index.js");
  const vmDist = path.join(repoRoot, "packages", "vm", "dist", "index.js");
  const vmRuntimeDist = path.join(repoRoot, "packages", "vm", "dist", "vm.js");
  await assertBuiltFile(bundlerDist, "bundler plugin");
  await assertBuiltFile(vmDist, "VM runtime");
  await assertBuiltFile(vmRuntimeDist, "inline VM runtime");

  const entry = normalizeEntry(args.entry ?? process.env.LODASH_ENTRY ?? DEFAULT_ENTRY);
  const functionSelection = parseFunctionSelection(
    args.functions ?? process.env.LODASH_MARK_FUNCTIONS,
  );
  const testCommand = args["test-command"]
    ?? process.env.LODASH_TEST_COMMAND
    ?? DEFAULT_TEST_COMMAND;
  const skipBaseline = readBoolean(args["skip-baseline"] ?? process.env.SKIP_LODASH_BASELINE);
  const keepTemp = readBoolean(args["keep-temp"] ?? process.env.KEEP_LODASH_TEMP);
  const seed = Number(args.seed ?? process.env.LODASH_OBFUSCATOR_SEED ?? "1");
  const memorySize = Number(args["memory-size"] ?? process.env.LODASH_VM_MEMORY_SIZE ?? "4096");

  if (!Number.isFinite(seed)) {
    throw new Error(`Invalid seed: ${args.seed ?? process.env.LODASH_OBFUSCATOR_SEED}`);
  }
  if (!Number.isFinite(memorySize) || memorySize <= 0) {
    throw new Error(`Invalid memory size: ${args["memory-size"] ?? process.env.LODASH_VM_MEMORY_SIZE}`);
  }

  const tempParent = await mkdtemp(path.join(tmpdir(), "experiment-vm-lodash-"));
  const workDir = path.join(tempParent, "lodash");
  let success = false;

  console.log(`[lodash-integration] copying lodash checkout to ${workDir}`);
  await cp(lodashDir, workDir, {
    recursive: true,
    filter: (source) => path.basename(source) !== ".git",
  });

  try {
    if (!skipBaseline) {
      console.log(`[lodash-integration] running baseline: ${testCommand}`);
      await runCommand(testCommand, workDir, process.env);
    }

    const entryPath = path.join(workDir, entry);
    const source = await readFile(entryPath, "utf8");
    const { code: markedSource, markedNames, skippedClosureCaptures } = markFunctions(source, functionSelection);
    console.log(`[lodash-integration] marked ${markedNames.length} function(s): ${markedNames.join(", ")}`);
    if (skippedClosureCaptures.length > 0) {
      console.log(
        `[lodash-integration] skipped ${skippedClosureCaptures.length} closure-capturing leaf function(s) in safe all mode; use --functions all-unsafe to reproduce those failures.`,
      );
    }

    const { transformSource } = await import(pathToFileURL(bundlerDist).href);
    const transformed = transformSource(markedSource, entryPath, {
      captureMode: "live",
      memorySize,
      seed,
    });
    if (!transformed) {
      throw new Error("Obfuscator returned null after markers were inserted.");
    }

    const runnableCode = await replaceRuntimeImportWithInline(transformed.code, vmRuntimeDist);
    await writeFile(entryPath, runnableCode);

    console.log(`[lodash-integration] obfuscated ${transformed.obfuscatedFunctions} function(s)`);
    console.log(`[lodash-integration] running obfuscated lodash tests: ${testCommand}`);
    await runCommand(testCommand, workDir, process.env);
    success = true;
  } finally {
    if (success && !keepTemp) {
      await rm(tempParent, { recursive: true, force: true });
    } else {
      console.log(`[lodash-integration] temp copy kept at ${workDir}`);
    }
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex !== -1) {
      args[withoutPrefix.slice(0, equalsIndex)] = withoutPrefix.slice(equalsIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[withoutPrefix] = "1";
      continue;
    }
    args[withoutPrefix] = next;
    index += 1;
  }
  return args;
}

async function assertLodashCheckout(lodashDir) {
  if (!existsSync(lodashDir)) {
    throw new Error(`LODASH_DIR does not exist: ${lodashDir}`);
  }
  const packageJsonPath = path.join(lodashDir, "package.json");
  const lodashJsPath = path.join(lodashDir, DEFAULT_ENTRY);
  await access(packageJsonPath);
  await access(lodashJsPath);
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  if (packageJson.name !== "lodash") {
    throw new Error(`Expected package.json name "lodash", got ${JSON.stringify(packageJson.name)}.`);
  }
}

async function assertBuiltFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing built ${label} at ${filePath}. Run pnpm build first.`);
  }
}

function normalizeEntry(entry) {
  const normalized = entry.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.includes("..")) {
    throw new Error(`Entry must stay inside the lodash checkout: ${entry}`);
  }
  return normalized;
}

function parseFunctionSelection(raw) {
  if (!raw || raw.trim() === "") {
    return { mode: "names", names: DEFAULT_FUNCTIONS };
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "all") {
    return { mode: "all", includeClosureCaptures: false };
  }
  if (normalized === "all-unsafe") {
    return { mode: "all", includeClosureCaptures: true };
  }
  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) {
    throw new Error("No function names were provided.");
  }
  return { mode: "names", names };
}

function readBoolean(value) {
  if (value === undefined) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function markFunctions(source, selection) {
  const ast = parser.parse(source, {
    allowReturnOutsideFunction: true,
    attachComment: true,
    errorRecovery: false,
    sourceType: "unambiguous",
  });
  const requestedNames = selection.mode === "names" ? new Set(selection.names) : null;
  const insertions = [];
  const markedNames = [];
  const skippedClosureCaptures = [];
  const availableNames = new Set();

  traverse(ast, {
    Function(path) {
      const name = getFunctionName(path);
      if (name) {
        availableNames.add(name);
      }
      if (selection.mode === "all" && hasNestedFunction(path)) {
        return;
      }
      if (
        selection.mode === "all"
        && !selection.includeClosureCaptures
        && capturesNonGlobalOuterBinding(path)
      ) {
        skippedClosureCaptures.push(name ?? `<anonymous@${path.node.start}>`);
        return;
      }
      if (!name && selection.mode !== "all") {
        return;
      }
      if (requestedNames && !requestedNames.has(name)) {
        return;
      }
      const position = path.node.start;
      if (typeof position !== "number" || hasNearbyMarker(source, position)) {
        return;
      }
      insertions.push({ position, text: ` ` });
      markedNames.push(name ?? `<anonymous@${position}>`);
    },
  });

  if (requestedNames) {
    const missing = [...requestedNames].filter((name) => !markedNames.includes(name));
    if (missing.length > 0) {
      const examples = [...availableNames].slice(0, 25).join(", ");
      throw new Error(
        `Could not find lodash function(s): ${missing.join(", ")}. Available examples: ${examples}`,
      );
    }
  }

  if (insertions.length === 0) {
    throw new Error("No functions were marked.");
  }

  insertions.sort((a, b) => b.position - a.position);
  let code = source;
  for (const insertion of insertions) {
    code = `${code.slice(0, insertion.position)}${insertion.text}${code.slice(insertion.position)}`;
  }

  return { code, markedNames, skippedClosureCaptures };
}

function capturesNonGlobalOuterBinding(path) {
  let found = false;
  path.traverse({
    Function(childPath) {
      childPath.skip();
    },
    ReferencedIdentifier(identifierPath) {
      const binding = identifierPath.scope.getBinding(identifierPath.node.name);
      if (!binding) {
        return;
      }
      if (binding.scope === path.scope || path.scope.hasOwnBinding(identifierPath.node.name)) {
        return;
      }
      if (!binding.scope.path.isProgram()) {
        found = true;
        identifierPath.stop();
      }
    },
  });
  return found;
}

function hasNestedFunction(path) {
  let found = false;
  path.traverse({
    Function(childPath) {
      found = true;
      childPath.stop();
    },
  });
  return found;
}

function getFunctionName(path) {
  const node = path.node;
  if (node.id?.name) {
    return node.id.name;
  }

  const parent = path.parentPath?.node;
  if (!parent) {
    return undefined;
  }

  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return parent.id.name;
  }
  if (parent.type === "AssignmentExpression") {
    return expressionName(parent.left);
  }
  if (parent.type === "ObjectProperty" || parent.type === "ObjectMethod") {
    return keyName(parent.key);
  }
  return undefined;
}

function expressionName(node) {
  if (node.type === "Identifier") {
    return node.name;
  }
  if (node.type === "MemberExpression") {
    return keyName(node.property);
  }
  return undefined;
}

function keyName(node) {
  if (node.type === "Identifier") {
    return node.name;
  }
  if (node.type === "StringLiteral") {
    return node.value;
  }
  return undefined;
}

function hasNearbyMarker(source, position) {
  return source.slice(Math.max(0, position - 80), position).includes(MARKER);
}

async function replaceRuntimeImportWithInline(code, vmRuntimeDist) {
  const importPattern = /^import\s+\{\s*executeVM\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s+from\s+["'][^"']+["'];\r?\n?/m;
  const match = code.match(importPattern);
  if (!match) {
    throw new Error("Could not find generated executeVM import in transformed output.");
  }
  const executeId = match[1];
  const vmRuntime = await readFile(vmRuntimeDist, "utf8");
  const inlineRuntime = vmRuntime
    .replace(/\bexport\s+var\s+Opcode\b/, "var Opcode")
    .replace(/\bexport\s+function\s+executeVM\b/, "function executeVM");
  if (/\bexport\b/.test(inlineRuntime) || /\bimport\b/.test(inlineRuntime)) {
    throw new Error(`Inline VM runtime still contains ESM syntax: ${vmRuntimeDist}`);
  }
  return code.replace(importPattern, `var ${executeId}=(function(){\n${inlineRuntime}\nreturn executeVM;\n}());\n`);
}

async function writeVmPreload(tempParent, vmDist, globalName) {
  const preloadPath = path.join(tempParent, "experiment-vm-preload.mjs");
  const source = [
    `import { executeVM } from ${JSON.stringify(pathToFileURL(vmDist).href)};`,
    `globalThis[${JSON.stringify(globalName)}] = executeVM;`,
    "",
  ].join("\n");
  await writeFile(preloadPath, source);
  return preloadPath;
}

function withNodeImportPreload(env, preloadPath) {
  const preload = `--import ${pathToFileURL(preloadPath).href}`;
  return {
    ...env,
    NODE_OPTIONS: env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${preload}` : preload,
  };
}

async function runCommand(command, cwd, env) {
  await mkdir(cwd, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        signal
          ? `Command failed with signal ${signal}: ${command}`
          : `Command failed with exit code ${code}: ${command}`,
      ));
    });
  });
}
