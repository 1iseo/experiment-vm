#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MARKER = "@vm-obfuscate";
const DEFAULT_REPO = "https://github.com/tastejs/todomvc.git";
const DEFAULT_REF = "master";
const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const SKIPPED_DIRS = new Set([
  ".git",
  ".cache",
  ".parcel-cache",
  ".turbo",
  "bower_components",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "spec",
  "test",
  "tests",
  "__tests__",
  "vendor",
  "vendors",
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultCheckoutDir = path.join(repoRoot, ".external", "todomvc");
const pluginRequire = createRequire(
  path.join(repoRoot, "packages", "bundler-plugin", "package.json"),
);
const parser = pluginRequire("@babel/parser");
const traverseModule = pluginRequire("@babel/traverse");
const traverse = typeof traverseModule === "function"
  ? traverseModule
  : traverseModule.default;

main().catch((error) => {
  console.error(`\n[todomvc-integration] ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const checkoutDir = path.resolve(
    args["todomvc-dir"] ?? process.env.TODOMVC_DIR ?? defaultCheckoutDir,
  );
  const ref = args.ref ?? process.env.TODOMVC_REF ?? DEFAULT_REF;
  const repo = args.repo ?? process.env.TODOMVC_REPO ?? DEFAULT_REPO;
  const exampleSelection = parseExampleSelection(
    args.examples ?? process.env.TODOMVC_EXAMPLES,
  );
  const testCommand = args["test-command"]
    ?? process.env.TODOMVC_TEST_COMMAND
    ?? buildDefaultTestCommand(exampleSelection);
  const skipBaseline = readBoolean(args["skip-baseline"] ?? process.env.SKIP_TODOMVC_BASELINE);
  const skipInstall = readBoolean(args["skip-install"] ?? process.env.SKIP_TODOMVC_INSTALL);
  const refresh = readBoolean(args.refresh ?? process.env.TODOMVC_REFRESH);
  const allCandidates = readBoolean(args["all-candidates"] ?? process.env.TODOMVC_ALL_CANDIDATES);
  const seed = Number(args.seed ?? process.env.TODOMVC_OBFUSCATOR_SEED ?? "1");
  const memorySize = Number(args["memory-size"] ?? process.env.TODOMVC_VM_MEMORY_SIZE ?? "4096");

  if (!Number.isFinite(seed)) {
    throw new Error(`Invalid seed: ${args.seed ?? process.env.TODOMVC_OBFUSCATOR_SEED}`);
  }
  if (!Number.isFinite(memorySize) || memorySize <= 0) {
    throw new Error(`Invalid memory size: ${args["memory-size"] ?? process.env.TODOMVC_VM_MEMORY_SIZE}`);
  }

  const bundlerDist = path.join(repoRoot, "packages", "bundler-plugin", "dist", "index.js");
  const vmDist = path.join(repoRoot, "packages", "vm", "dist", "index.js");
  const vmRuntimeDist = path.join(repoRoot, "packages", "vm", "dist", "vm.js");
  await assertBuiltFile(bundlerDist, "bundler plugin");
  await assertBuiltFile(vmDist, "VM runtime");
  await assertBuiltFile(vmRuntimeDist, "inline VM runtime");

  await ensureCheckout({ checkoutDir, ref, refresh, repo });
  const commandEnv = buildCommandEnv(checkoutDir);
  if (!skipInstall) {
    await ensureDependencies(checkoutDir, commandEnv);
  }

  const commit = await runProcessCapture("git", ["-C", checkoutDir, "rev-parse", "HEAD"]);
  console.log(`[todomvc-integration] checkout: ${checkoutDir}`);
  console.log(`[todomvc-integration] commit: ${commit.trim()}`);

  if (!skipBaseline) {
    console.log(`[todomvc-integration] running baseline: ${testCommand}`);
    await runShellCommand(testCommand, checkoutDir, commandEnv);
  }

  const examples = await discoverExamples(checkoutDir, exampleSelection, { allCandidates });
  if (examples.length === 0) {
    throw new Error("No TodoMVC examples were discovered.");
  }
  console.log(`[todomvc-integration] discovered ${examples.length} example(s)`);
  if (!skipInstall) {
    for (const example of examples) {
      await ensureExampleDependencies(example, commandEnv);
    }
  }

  const { transformSource } = await import(pathToFileURL(bundlerDist).href);
  let totalFiles = 0;
  let totalFunctions = 0;
  for (const example of examples) {
    const stats = await obfuscateExample({
      example,
      memorySize,
      seed,
      transformSource,
      vmRuntimeDist,
    });
    if (stats.functions === 0) {
      throw new Error(`No functions were obfuscated for example '${example.name}'.`);
    }
    totalFiles += stats.files;
    totalFunctions += stats.functions;
    console.log(
      `[todomvc-integration] ${example.name}: obfuscated ${stats.functions} function(s) in ${stats.files} file(s)`,
    );
  }

  console.log(
    `[todomvc-integration] obfuscated ${totalFunctions} function(s) across ${totalFiles} file(s)`,
  );
  console.log(`[todomvc-integration] running obfuscated TodoMVC tests: ${testCommand}`);
  await runShellCommand(testCommand, checkoutDir, commandEnv);
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

function parseExampleSelection(raw) {
  if (!raw || raw.trim() === "") {
    return null;
  }
  return new Set(
    raw
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
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

async function assertBuiltFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing built ${label} at ${filePath}. Run pnpm build first.`);
  }
}

async function ensureCheckout({ checkoutDir, ref, refresh, repo }) {
  if (!existsSync(checkoutDir)) {
    await mkdir(path.dirname(checkoutDir), { recursive: true });
    console.log(`[todomvc-integration] cloning ${repo} to ${checkoutDir}`);
    await runProcess("git", ["clone", repo, checkoutDir], repoRoot);
  } else {
    await access(path.join(checkoutDir, ".git"));
  }

  if (refresh) {
    console.log(`[todomvc-integration] fetching ${ref}`);
    await runProcess("git", ["-C", checkoutDir, "fetch", "origin", ref], repoRoot);
  }

  await runProcess("git", ["-C", checkoutDir, "checkout", ref], repoRoot);
  if (refresh && ref === DEFAULT_REF) {
    await runProcess("git", ["-C", checkoutDir, "reset", "--hard", `origin/${DEFAULT_REF}`], repoRoot);
  } else {
    await runProcess("git", ["-C", checkoutDir, "reset", "--hard", "HEAD"], repoRoot);
  }
  await runProcess("git", ["-C", checkoutDir, "clean", "-fd"], repoRoot);
}

function buildCommandEnv(checkoutDir) {
  return {
    ...process.env,
    CYPRESS_CACHE_FOLDER: process.env.CYPRESS_CACHE_FOLDER
      ?? path.join(checkoutDir, "node_modules", ".cache", "Cypress"),
  };
}

async function ensureDependencies(checkoutDir, env) {
  if (existsSync(path.join(checkoutDir, "node_modules"))) {
    await ensureCypressBinary(checkoutDir, env);
    return;
  }
  const command = existsSync(path.join(checkoutDir, "package-lock.json"))
    ? "npm ci"
    : "npm install";
  console.log(`[todomvc-integration] installing TodoMVC dependencies: ${command}`);
  await runShellCommand(command, checkoutDir, env);
  await ensureCypressBinary(checkoutDir, env);
}

async function ensureExampleDependencies(example, env) {
  if (!existsSync(path.join(example.dir, "package.json"))) {
    return;
  }
  if (existsSync(path.join(example.dir, "node_modules"))) {
    return;
  }
  const command = existsSync(path.join(example.dir, "package-lock.json"))
    ? "npm ci"
    : "npm install";
  console.log(`[todomvc-integration] installing ${example.name} dependencies: ${command}`);
  await runShellCommand(command, example.dir, env);
}

async function ensureCypressBinary(checkoutDir, env) {
  if (!await hasCypressDependency(checkoutDir)) {
    return;
  }
  const verified = await runShellCommandStatus("npm exec cypress verify", checkoutDir, env);
  if (verified === 0) {
    return;
  }
  console.log("[todomvc-integration] installing Cypress binary");
  await runShellCommand("npm exec cypress install --force", checkoutDir, env);
  await runShellCommand("npm exec cypress verify", checkoutDir, env);
}

async function hasCypressDependency(checkoutDir) {
  const packageJson = JSON.parse(
    await readFile(path.join(checkoutDir, "package.json"), "utf8"),
  );
  return Boolean(packageJson.dependencies?.cypress || packageJson.devDependencies?.cypress);
}

function buildDefaultTestCommand(selection) {
  const runner = selection
    ? `node tests/cya.js ${[...selection].map((name) => `-f ${shellWord(name)}`).join(" ")}`
    : "node tests/cya.js --all";
  return `npm exec -- start-server-and-test server http://localhost:8000 "${runner}"`;
}

function shellWord(value) {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`Unsafe shell argument: ${value}`);
  }
  return value;
}

async function discoverExamples(checkoutDir, selection, options) {
  const examplesDir = path.join(checkoutDir, "examples");
  const defaultExcluded = selection ? new Set() : await loadExcludedExamples(checkoutDir);
  const entries = await readdir(examplesDir, { withFileTypes: true });
  const examples = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    if (!selection && defaultExcluded.has(entry.name)) {
      continue;
    }
    if (selection && !selection.has(entry.name)) {
      continue;
    }
    const dir = path.join(examplesDir, entry.name);
    const candidates = await discoverCandidateFiles(dir, options);
    if (candidates.length === 0) {
      continue;
    }
    examples.push({ name: entry.name, dir, files: candidates });
  }

  if (selection) {
    const discovered = new Set(examples.map((example) => example.name));
    const missing = [...selection].filter((name) => !discovered.has(name));
    if (missing.length > 0) {
      throw new Error(`Could not find runnable example(s): ${missing.join(", ")}`);
    }
  }

  examples.sort((a, b) => a.name.localeCompare(b.name));
  return examples;
}

async function loadExcludedExamples(checkoutDir) {
  const excludedPath = path.join(checkoutDir, "tests", "excluded.js");
  if (!existsSync(excludedPath)) {
    return new Set();
  }
  const module = await import(pathToFileURL(excludedPath).href);
  return new Set(Array.isArray(module.default) ? module.default : []);
}

async function discoverCandidateFiles(dir, options) {
  const files = [];
  await walk(dir, files, options);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

async function walk(dir, files, options) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) {
        await walk(fullPath, files, options);
      }
      continue;
    }
    if (!entry.isFile() || !isCandidateFile(fullPath, options)) {
      continue;
    }
    files.push(fullPath);
  }
}

function isCandidateFile(filePath, options) {
  const ext = path.extname(filePath);
  if (!CODE_EXTENSIONS.has(ext)) {
    return false;
  }
  const base = path.basename(filePath);
  if (
    base.endsWith(".min.js")
    || base.endsWith(".bundle.js")
    || base.includes(".config.")
    || base === "vite.config.js"
    || base === "webpack.config.js"
    || base === "rollup.config.js"
  ) {
    return false;
  }
  return options.allCandidates || isConservativeTodoMvcCandidate(filePath);
}

function isConservativeTodoMvcCandidate(filePath) {
  return /(^|[\\/])template\.[cm]?[jt]sx?$/.test(filePath);
}

async function obfuscateExample(input) {
  let files = 0;
  let functions = 0;
  for (const filePath of input.example.files) {
    const fileStats = await stat(filePath);
    if (fileStats.size === 0) {
      continue;
    }
    const source = await readFile(filePath, "utf8");
    if (!couldContainFunction(source)) {
      continue;
    }

    const marked = markFunctions(source, filePath);
    if (marked.markedNames.length === 0) {
      continue;
    }

    const transformed = input.transformSource(marked.code, filePath, {
      captureMode: "live",
      memorySize: input.memorySize,
      seed: input.seed,
    });
    if (!transformed) {
      throw new Error(`Obfuscator returned null for ${filePath} after markers were inserted.`);
    }

    const runnableCode = await replaceRuntimeImportWithInline(
      transformed.code,
      input.vmRuntimeDist,
    );
    await writeFile(filePath, runnableCode);
    files += 1;
    functions += transformed.obfuscatedFunctions;
  }
  return { files, functions };
}

function couldContainFunction(source) {
  return /\bfunction\b|=>/.test(source);
}

function markFunctions(source, filePath) {
  const ast = parser.parse(source, {
    allowReturnOutsideFunction: true,
    attachComment: true,
    errorRecovery: false,
    plugins: parserPlugins(filePath),
    sourceType: "unambiguous",
  });
  const insertions = [];
  const markedNames = [];
  const skippedClosureCaptures = [];

  traverse(ast, {
    Function(path) {
      if (path.node.async || path.node.generator) {
        return;
      }
      if (referencesUnsupportedRuntimeBinding(path)) {
        skippedClosureCaptures.push(getFunctionName(path) ?? `<anonymous@${path.node.start}>`);
        return;
      }
      if (hasCallbackLikeParameter(path)) {
        skippedClosureCaptures.push(getFunctionName(path) ?? `<anonymous@${path.node.start}>`);
        return;
      }
      if (hasNestedFunction(path)) {
        return;
      }
      if (capturesNonGlobalOuterBinding(path)) {
        skippedClosureCaptures.push(getFunctionName(path) ?? `<anonymous@${path.node.start}>`);
        return;
      }
      const position = path.node.start;
      if (typeof position !== "number" || hasNearbyMarker(source, position)) {
        return;
      }
      insertions.push({ position, text: ` ` });
      markedNames.push(getFunctionName(path) ?? `<anonymous@${position}>`);
    },
  });

  insertions.sort((a, b) => b.position - a.position);
  let code = source;
  for (const insertion of insertions) {
    code = `${code.slice(0, insertion.position)}${insertion.text}${code.slice(insertion.position)}`;
  }

  return { code, markedNames, skippedClosureCaptures };
}

function parserPlugins(filePath) {
  const plugins = ["jsx"];
  if (/\.[cm]?tsx?$/.test(filePath)) {
    plugins.push("typescript");
  }
  return plugins;
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

function hasCallbackLikeParameter(path) {
  return path.node.params.some((param) => {
    if (param.type !== "Identifier") {
      return false;
    }
    return /^(callback|cb|handler|listener|on[A-Z])/.test(param.name);
  });
}

function referencesUnsupportedRuntimeBinding(path) {
  let found = false;
  path.traverse({
    Function(childPath) {
      childPath.skip();
    },
    ThisExpression(thisPath) {
      found = true;
      thisPath.stop();
    },
    Super(superPath) {
      found = true;
      superPath.stop();
    },
    ReferencedIdentifier(identifierPath) {
      if (path.isArrowFunctionExpression() && identifierPath.node.name === "arguments") {
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
  if (parent.type === "ClassMethod" || parent.type === "ClassPrivateMethod") {
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
  if (node.type === "NumericLiteral") {
    return String(node.value);
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

async function runProcess(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
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
          ? `Command failed with signal ${signal}: ${command} ${args.join(" ")}`
          : `Command failed with exit code ${code}: ${command} ${args.join(" ")}`,
      ));
    });
  });
}

async function runProcessCapture(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(
        signal
          ? `Command failed with signal ${signal}: ${command} ${args.join(" ")}`
          : `Command failed with exit code ${code}: ${command} ${args.join(" ")}\n${stderr}`,
      ));
    });
  });
}

async function runShellCommand(command, cwd, env) {
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

async function runShellCommandStatus(command, cwd, env) {
  await mkdir(cwd, { recursive: true });
  return await new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Command failed with signal ${signal}: ${command}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}
