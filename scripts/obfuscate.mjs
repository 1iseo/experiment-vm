#!/usr/bin/env node
import { exec } from "node:child_process";
import {
  access,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import JavaScriptObfuscator from "javascript-obfuscator";
import { transformSource } from "../packages/bundler-plugin/dist/index.js";

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const datasetDir = path.join(repoRoot, "dataset", "manual");
const testDir = path.join(repoRoot, "dataset", "tests");
const outputDir = path.join(repoRoot, "dataset", "obfuscated");
const vmOutputDir = path.join(outputDir, "dobf-vm");
const tradOutputDir = path.join(outputDir, "dobf-trad");
const layeredOutputDir = path.join(outputDir, "dobf-layered");

const javascriptObfuscatorOptions = {
  compact: true,
  controlFlowFlattening: true,
  renameGlobals: true,
  compact: true,
  controlFlowFlatteningThreshold: 1.0,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 1.0,
  identifierNamesGenerator: "hexadecimal",
};

const layeredObfuscationOptions = {
  optionsPreset: "medium-obfuscation",
};
const buildSeed = resolveBuildSeed(process.env.OBFUSCATION_SEED);

async function runCommand(cmd, cwd, env = {}) {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      env: { ...process.env, ...env },
    });
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return {
      success: false,
      stdout: error.stdout?.trim() || "",
      stderr: error.stderr?.trim() || error.message,
    };
  }
}

function areOutputsEquivalent(out1, out2) {
  const lines1 = out1
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const lines2 = out2
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines1.length !== lines2.length) {
    return false;
  }

  for (let i = 0; i < lines1.length; i++) {
    const l1 = lines1[i];
    const l2 = lines2[i];

    if (l1 === l2) {
      continue;
    }

    try {
      const j1 = JSON.parse(l1);
      const j2 = JSON.parse(l2);
      if (deepEqual(j1, j2)) {
        continue;
      }
    } catch {

    }
    return false;
  }
  return true;
}

function deepEqual(obj1, obj2) {
  if (obj1 === obj2) return true;
  if (obj1 == null || obj2 == null) return false;
  if (typeof obj1 !== typeof obj2) return false;

  if (Array.isArray(obj1)) {
    if (!Array.isArray(obj2) || obj1.length !== obj2.length) return false;
    for (let i = 0; i < obj1.length; i++) {
      if (!deepEqual(obj1[i], obj2[i])) return false;
    }
    return true;
  }

  if (typeof obj1 === "object") {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    if (keys1.length !== keys2.length) return false;
    for (const key of keys1) {
      if (!Object.prototype.hasOwnProperty.call(obj2, key)) return false;
      if (!deepEqual(obj1[key], obj2[key])) return false;
    }
    return true;
  }
  return false;
}

async function main() {
  console.log("=== JavaScript Obfuscation Dataset Tool ===");
  console.log(`Build seed: ${buildSeed}`);
  console.log("Preparing directories...");
  await mkdir(vmOutputDir, { recursive: true });
  await mkdir(tradOutputDir, { recursive: true });
  await mkdir(layeredOutputDir, { recursive: true });

  console.log("Scanning manual dataset directory...");
  let files;
  try {
    files = (await readdir(datasetDir)).filter((file) => file.endsWith(".js"));
  } catch (error) {
    console.error(`Error reading dataset directory: ${error.message}`);
    process.exit(1);
  }

  const requestedFiles = parseRequestedFiles(process.argv.slice(2));
  if (requestedFiles) {
    const available = new Set(files);
    const missing = requestedFiles.filter((file) => !available.has(file));
    if (missing.length > 0) {
      throw new Error(`Unknown dataset file(s): ${missing.join(", ")}`);
    }
    files = requestedFiles;
  }

  console.log(`Found ${files.length} JavaScript files to obfuscate.`);

  const report = [];

  for (const file of files) {
    console.log(`\nProcessing: ${file}`);
    const originalPath = path.join(datasetDir, file);
    const vmOutputPath = path.join(vmOutputDir, file);
    const tradOutputPath = path.join(tradOutputDir, file);
    const layeredOutputPath = path.join(layeredOutputDir, file);
    const testPath = path.join(
      testDir,
      `${path.basename(file, ".js")}.test.js`,
    );
    const hasExternalTest = await pathExists(testPath);

    const originalSource = await readFile(originalPath, "utf-8");
    const fileSeed = deriveFileSeed(buildSeed, file);
    const originalStats = await stat(originalPath);
    const originalSizeKb = originalStats.size / 1024;

    let baselineRun;
    let vmRun;
    let tradRun;
    let layeredRun;

    let vmSizeKb = 0;
    let tradSizeKb = 0;
    let layeredSizeKb = 0;

    let vmStatus = "PENDING";
    let tradStatus = "PENDING";
    let layeredStatus = "PENDING";

    let vmResult;

    baselineRun = hasExternalTest
      ? await runDatasetTest(testPath, originalPath)
      : await runCommand(`node ${file}`, datasetDir);
    if (!baselineRun.success) {
      console.error(`  [Original] Failed to run: ${baselineRun.stderr}`);
      report.push({
        file,
        originalSizeKb,
        vmSizeKb: null,
        tradSizeKb: null,
        status: "ORIGINAL_FAILED",
      });
      continue;
    }

    try {
      vmResult = transformSource(originalSource, originalPath, {
        inlineRuntime: true,
        renameInternalNames: true,
        seed: fileSeed,
      });

      if (vmResult && vmResult.code) {
        await writeFile(vmOutputPath, vmResult.code, "utf-8");
        const vmStats = await stat(vmOutputPath);
        vmSizeKb = vmStats.size / 1024;

        vmRun = hasExternalTest
          ? await runDatasetTest(testPath, vmOutputPath)
          : await runCommand(`node ${file}`, vmOutputDir);
        if (
          vmRun.success &&
          areOutputsEquivalent(vmRun.stdout, baselineRun.stdout)
        ) {
          vmStatus = "PASS";
        } else {
          vmStatus = vmRun.success ? "FAIL_OUTPUT" : "FAIL_CRASH";
          if (!vmRun.success) console.error(`  [VM] Crash: ${vmRun.stderr}`);
          else
            console.error(
              `  [VM] Mismatch: Expected "${baselineRun.stdout}" but got "${vmRun.stdout}"`,
            );
        }
      } else {
        vmStatus = "FAIL_EMPTY";
      }
    } catch (err) {
      vmStatus = "FAIL_ERROR";
      console.error(`  [VM] Error: ${err.message}`);
    }

    try {
      const tradResult = JavaScriptObfuscator.obfuscate(
        originalSource,
        { ...javascriptObfuscatorOptions, seed: fileSeed },
      );
      const tradCode = tradResult.getObfuscatedCode();

      await writeFile(tradOutputPath, tradCode, "utf-8");
      const tradStats = await stat(tradOutputPath);
      tradSizeKb = tradStats.size / 1024;

      tradRun = hasExternalTest
        ? await runDatasetTest(testPath, tradOutputPath)
        : await runCommand(`node ${file}`, tradOutputDir);
      if (
        tradRun.success &&
        areOutputsEquivalent(tradRun.stdout, baselineRun.stdout)
      ) {
        tradStatus = "PASS";
      } else {
        tradStatus = tradRun.success ? "FAIL_OUTPUT" : "FAIL_CRASH";
        if (!tradRun.success)
          console.error(`  [Trad] Crash: ${tradRun.stderr}`);
        else
          console.error(
            `  [Trad] Mismatch: Expected "${baselineRun.stdout}" but got "${tradRun.stdout}"`,
          );
      }
    } catch (err) {
      tradStatus = "FAIL_ERROR";
      console.error(`  [Trad] Error: ${err.message}`);
    }

    if (vmResult && vmResult.code) {
      try {
        const layeredResult = JavaScriptObfuscator.obfuscate(
          vmResult.code,
          { ...javascriptObfuscatorOptions, seed: fileSeed ^ 0x6d2b79f5 },
        );
        const layeredCode = layeredResult.getObfuscatedCode();

        await writeFile(layeredOutputPath, layeredCode, "utf-8");
        const layeredStats = await stat(layeredOutputPath);
        layeredSizeKb = layeredStats.size / 1024;

        layeredRun = hasExternalTest
          ? await runDatasetTest(testPath, layeredOutputPath)
          : await runCommand(`node ${file}`, layeredOutputDir);
        if (
          layeredRun.success &&
          areOutputsEquivalent(layeredRun.stdout, baselineRun.stdout)
        ) {
          layeredStatus = "PASS";
        } else {
          layeredStatus = layeredRun.success ? "FAIL_OUTPUT" : "FAIL_CRASH";
          if (!layeredRun.success)
            console.error(`  [Layered] Crash: ${layeredRun.stderr}`);
          else
            console.error(
              `  [Layered] Mismatch: Expected "${baselineRun.stdout}" but got "${layeredRun.stdout}"`,
            );
        }
      } catch (err) {
        layeredStatus = "FAIL_ERROR";
        console.error(`  [Layered] Error: ${err.message}`);
      }
    } else {
      layeredStatus = "SKIPPED";
    }

    report.push({
      file,
      originalSizeKb,
      vmSizeKb,
      tradSizeKb,
      layeredSizeKb,
      vmStatus,
      tradStatus,
      layeredStatus,
    });

    console.log(
      `  Sizes: Orig = ${originalSizeKb.toFixed(2)} KB | Trad = ${tradSizeKb.toFixed(2)} KB | VM = ${vmSizeKb.toFixed(2)} KB | Layered = ${layeredSizeKb.toFixed(2)} KB`,
    );
    console.log(
      `  Status: Trad = ${tradStatus} | VM = ${vmStatus} | Layered = ${layeredStatus}`,
    );
  }

  console.log("\n=== OBFUSCATION SUMMARY ===");
  console.log(
    "| File | Original (KB) | AST-Obfuscated (KB) | VM-Obfuscated (KB) | Layered (KB) | AST Verif | VM Verif | Layered Verif |",
  );
  console.log(
    "|------|---------------|---------------------|--------------------|--------------|-----------|----------|---------------|",
  );
  for (const item of report) {
    console.log(
      `| ${item.file} | ${item.originalSizeKb.toFixed(2)} | ${item.tradSizeKb ? item.tradSizeKb.toFixed(2) : "N/A"} | ${item.vmSizeKb ? item.vmSizeKb.toFixed(2) : "N/A"} | ${item.layeredSizeKb ? item.layeredSizeKb.toFixed(2) : "N/A"} | ${item.tradStatus || "N/A"} | ${item.vmStatus || "N/A"} | ${item.layeredStatus || "N/A"} |`,
    );
  }
}

function parseRequestedFiles(args) {
  const optionIndex = args.indexOf("--files");
  if (optionIndex === -1) {
    return null;
  }
  const value = args[optionIndex + 1];
  if (!value) {
    throw new Error("--files requires a comma-separated file list.");
  }
  return [...new Set(value.split(",").map((file) => {
    const trimmed = file.trim();
    return trimmed.endsWith(".js") ? trimmed : `${trimmed}.js`;
  }).filter(Boolean))];
}

function resolveBuildSeed(value) {
  if (value != null && value !== "") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error("OBFUSCATION_SEED must be a safe integer.");
    }
    return parsed >>> 0;
  }
  return (
    (Date.now() >>> 0) ^
    Math.floor(Math.random() * 0x100000000)
  ) >>> 0;
}

function deriveFileSeed(seed, file) {
  let hash = seed >>> 0;
  for (let i = 0; i < file.length; i += 1) {
    hash ^= file.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

async function runDatasetTest(testPath, targetPath) {
  return runCommand(`node "${path.basename(testPath)}"`, testDir, {
    DATASET_TARGET: pathToFileURL(targetPath).href,
  });
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
