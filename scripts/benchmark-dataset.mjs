#!/usr/bin/env node
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const manualDir = path.join(repoRoot, "dataset", "manual");
const testDir = path.join(repoRoot, "dataset", "tests");
const outputRoot = path.join(repoRoot, "dataset", "obfuscated");
const jsonPath = path.join(repoRoot, "dataset_benchmark_results.json");
const markdownPath = path.join(repoRoot, "dataset_benchmark_results.md");
const measuredRuns = parsePositiveInt(
  readOption("--runs") ?? process.env.BENCHMARK_RUNS,
  5,
);
const warmupRuns = parseNonNegativeInt(
  readOption("--warmups") ?? process.env.BENCHMARK_WARMUPS,
  1,
);

const variants = [
  { id: "original", label: "Original", directory: manualDir },
  {
    id: "trad",
    label: "AST-Based",
    directory: path.join(outputRoot, "dobf-trad"),
  },
  {
    id: "vm",
    label: "VM",
    directory: path.join(outputRoot, "dobf-vm"),
  },
  {
    id: "layered",
    label: "Layered",
    directory: path.join(outputRoot, "dobf-layered"),
  },
];

async function main() {
  const files = (await fs.readdir(manualDir))
    .filter((file) => file.endsWith(".js"))
    .sort();
  const results = [];

  console.log("=== Dataset Size and Runtime Benchmark ===");
  console.log(`Files: ${files.length}`);
  console.log(`Measured runs per variant: ${measuredRuns}`);
  console.log(`Warm-up runs per variant: ${warmupRuns}`);

  for (const [fileIndex, file] of files.entries()) {
    const testPath = path.join(
      testDir,
      `${path.basename(file, ".js")}.test.js`,
    );
    await fs.access(testPath);

    console.log(`[${fileIndex + 1}/${files.length}] ${file}`);
    const fileResult = { file, variants: {} };
    let expectedOutput = null;

    for (let variantOffset = 0; variantOffset < variants.length; variantOffset += 1) {
      const variant = variants[
        (variantOffset + fileIndex) % variants.length
      ];
      const targetPath = path.join(variant.directory, file);
      const stats = await fs.stat(targetPath);

      for (let run = 0; run < warmupRuns; run += 1) {
        const warmup = await runHarness(testPath, targetPath);
        expectedOutput = verifyOutput({
          actual: warmup.stdout,
          expected: expectedOutput,
          file,
          variant: variant.label,
        });
      }

      const runsMs = [];
      for (let run = 0; run < measuredRuns; run += 1) {
        const measured = await runHarness(testPath, targetPath);
        expectedOutput = verifyOutput({
          actual: measured.stdout,
          expected: expectedOutput,
          file,
          variant: variant.label,
        });
        runsMs.push(measured.elapsedMs);
      }

      fileResult.variants[variant.id] = {
        sizeBytes: stats.size,
        sizeKiB: stats.size / 1024,
        runtime: summarizeRuns(runsMs),
      };
    }

    fileResult.outputSha256 = hashText(expectedOutput);
    results.push(fileResult);
  }

  const benchmark = {
    version: 1,
    measuredAt: new Date().toISOString(),
    runtime: {
      executable: process.execPath,
      nodeVersion: process.version,
      platform: `${process.platform}-${process.arch}`,
      method:
        "End-to-end Node.js process time including module loading, parsing, VM initialization, test execution, and process shutdown.",
      measuredRuns,
      warmupRuns,
    },
    variants: variants.map(({ id, label }) => ({ id, label })),
    summary: buildSummary(results),
    files: results,
  };

  await writeJsonAtomic(jsonPath, benchmark);
  await writeTextAtomic(markdownPath, renderMarkdown(benchmark));

  console.log("");
  for (const variant of variants) {
    const summary = benchmark.summary[variant.id];
    console.log(
      `${variant.label}: avg size ${summary.averageSizeKiB.toFixed(2)} KiB, ` +
        `avg runtime ${summary.averageRuntimeMs.toFixed(2)} ms`,
    );
  }
  console.log(`JSON: ${jsonPath}`);
  console.log(`Markdown: ${markdownPath}`);
}

function verifyOutput({ actual, expected, file, variant }) {
  const normalized = normalizeOutput(actual);
  if (expected == null) {
    return normalized;
  }
  if (normalized !== expected) {
    throw new Error(
      `Output mismatch for ${file} (${variant}). ` +
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(normalized)}.`,
    );
  }
  return expected;
}

function normalizeOutput(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.stringify(canonicalize(JSON.parse(line)));
      } catch {
        return line;
      }
    })
    .join("\n");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalize(value[key]);
    }
    return result;
  }
  return value;
}

function runHarness(testPath, targetPath) {
  return new Promise((resolve, reject) => {
    const startedAt = process.hrtime.bigint();
    const child = spawn(process.execPath, [testPath], {
      cwd: testDir,
      env: {
        ...process.env,
        DATASET_TARGET: pathToFileURL(targetPath).href,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const elapsedMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      if (code !== 0) {
        reject(
          new Error(
            `Benchmark process failed for ${targetPath} ` +
              `(code=${code}, signal=${signal ?? "none"}): ${stderr.trim()}`,
          ),
        );
        return;
      }
      resolve({ elapsedMs, stdout, stderr });
    });
  });
}

function summarizeRuns(runsMs) {
  const total = runsMs.reduce((sum, value) => sum + value, 0);
  return {
    runsMs,
    averageMs: total / runsMs.length,
    minimumMs: Math.min(...runsMs),
    maximumMs: Math.max(...runsMs),
  };
}

function buildSummary(results) {
  const summary = {};
  for (const variant of variants) {
    const entries = results.map((result) => result.variants[variant.id]);
    const totalSizeBytes = entries.reduce(
      (sum, entry) => sum + entry.sizeBytes,
      0,
    );
    const averageRuntimeMs =
      entries.reduce((sum, entry) => sum + entry.runtime.averageMs, 0) /
      entries.length;
    summary[variant.id] = {
      files: entries.length,
      totalSizeBytes,
      totalSizeKiB: totalSizeBytes / 1024,
      averageSizeKiB: totalSizeBytes / entries.length / 1024,
      averageRuntimeMs,
    };
  }

  const original = summary.original;
  for (const variant of variants) {
    const entry = summary[variant.id];
    entry.sizeRatio = entry.totalSizeBytes / original.totalSizeBytes;
    entry.runtimeRatio = entry.averageRuntimeMs / original.averageRuntimeMs;
  }
  return summary;
}

function renderMarkdown(benchmark) {
  const header = [
    "| File | Original KiB | AST KiB | VM KiB | Layered KiB | Original ms | AST ms | VM ms | Layered ms |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  const rows = benchmark.files.map((entry) => {
    const value = entry.variants;
    return [
      `| ${entry.file}`,
      value.original.sizeKiB.toFixed(2),
      value.trad.sizeKiB.toFixed(2),
      value.vm.sizeKiB.toFixed(2),
      value.layered.sizeKiB.toFixed(2),
      value.original.runtime.averageMs.toFixed(2),
      value.trad.runtime.averageMs.toFixed(2),
      value.vm.runtime.averageMs.toFixed(2),
      `${value.layered.runtime.averageMs.toFixed(2)} |`,
    ].join(" | ");
  });
  const summaryRows = variants.map((variant) => {
    const value = benchmark.summary[variant.id];
    return `- ${variant.label}: average size ${value.averageSizeKiB.toFixed(2)} KiB (${value.sizeRatio.toFixed(2)}x), average runtime ${value.averageRuntimeMs.toFixed(2)} ms (${value.runtimeRatio.toFixed(2)}x)`;
  });

  return [
    "# Dataset Benchmark Results",
    "",
    `- Measured at: ${benchmark.measuredAt}`,
    `- Node.js: ${benchmark.runtime.nodeVersion}`,
    `- Runs: ${benchmark.runtime.measuredRuns} measured + ${benchmark.runtime.warmupRuns} warm-up`,
    `- Method: ${benchmark.runtime.method}`,
    "",
    "## Summary",
    "",
    ...summaryRows,
    "",
    "## Per-file results",
    "",
    ...header,
    ...rows,
    "",
  ].join("\n");
}

async function writeJsonAtomic(filePath, value) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, value, "utf8");
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.rename(temporaryPath, filePath);
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parsePositiveInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}.`);
  }
  return parsed;
}

function parseNonNegativeInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received ${value}.`);
  }
  return parsed;
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exitCode = 1;
});
