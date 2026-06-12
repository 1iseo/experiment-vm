#!/usr/bin/env node
import {
  createGateway,
  generateText,
  jsonSchema,
  NoOutputGeneratedError,
  Output,
} from "ai";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const manualDir = path.join(repoRoot, "dataset", "manual");
const tradDir = path.join(repoRoot, "dataset", "obfuscated", "dobf-trad");
const layeredDir = path.join(repoRoot, "dataset", "obfuscated", "dobf-layered");
const legacyCheckpointPath = path.join(repoRoot, "llm_evaluation_results.json");
const forceFresh =
  process.argv.includes("--fresh") || process.argv.includes("--reset");
const STATE_VERSION = 3;

const apiKey =
  process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_AI_GATEWAY_API_KEY;
if (!apiKey) {
  console.error(
    "ERROR: Please set AI_GATEWAY_API_KEY (or VERCEL_AI_GATEWAY_API_KEY).",
  );
  console.error(
    "Usage on Windows: $env:AI_GATEWAY_API_KEY='your-key'; node scripts/evaluate-llm.mjs",
  );
  process.exit(1);
}

const config = {
  baseURL:
    process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v4/ai",
  model: process.env.AI_GATEWAY_MODEL ?? "openai/gpt-oss-120b",
  timeoutMs: parsePositiveInt(process.env.LLM_EVALUATION_TIMEOUT_MS, 150000),
  maxRetries: parsePositiveInt(process.env.LLM_EVALUATION_MAX_RETRIES, 3),
  maxOutputTokens: parsePositiveInt(
    process.env.LLM_EVALUATION_MAX_OUTPUT_TOKENS,
    2048,
  ),
  delayMs: parsePositiveInt(process.env.LLM_EVALUATION_DELAY_MS, 250),
  promptVersion: 3,
};

const resultFileStem = `llm_evaluation_results.${modelFileSlug(config.model)}`;
const checkpointPath = path.join(repoRoot, `${resultFileStem}.json`);
const summaryPath = path.join(repoRoot, `${resultFileStem}.md`);

const gateway = createGateway({
  apiKey,
  baseURL: config.baseURL,
});

const SYSTEM_PROMPT = [
  "You are an expert JavaScript reverse engineer.",
  "Classify the obfuscated code into exactly one known dataset label or UNKNOWN.",
  "confidence_score must be an integer from 0 to 100.",
  "prediction must be one of the provided labels or UNKNOWN.",
].join(" ");

async function main() {
  console.log("=== LLM Automated Evaluation with Vercel AI Gateway ===");
  console.log(`Model: ${config.model}`);
  console.log(`Base URL: ${config.baseURL}`);

  const manualFiles = await listDatasetFiles(manualDir);
  const validNames = manualFiles.map((file) => path.basename(file, ".js"));

  const state = await loadState({
    manualFiles,
    validNames,
    config,
  });

  console.log(`Manual files found: ${manualFiles.length}`);
  console.log("Scanning file checksums and resuming where needed...");

  let workCount = 0;
  for (const file of manualFiles) {
    const expectedName = path.basename(file, ".js");

    const snapshot = await buildFileSnapshot(file);
    const tradPath = snapshot.tradPath;
    const layeredPath = snapshot.layeredPath;
    const existing = state.results[file];
    const checksumsMatch =
      existing && sameChecksums(existing.checksums, snapshot.checksums);

    if (checksumsMatch && existing.status === "done") {
      continue;
    }

    if (!snapshot.tradExists || !snapshot.layeredExists) {
      if (checksumsMatch && existing.status === "skipped") {
        continue;
      }

      console.log(`\nSkipping: ${file}`);
      state.results[file] = {
        file,
        expected: expectedName,
        status: "skipped",
        reason:
          !snapshot.tradExists && !snapshot.layeredExists
            ? "Missing obfuscated files in both trad and layered outputs."
            : !snapshot.tradExists
              ? "Missing AST-obfuscated file."
              : "Missing layered-obfuscated file.",
        checksums: snapshot.checksums,
        updatedAt: new Date().toISOString(),
      };
      console.log(`  SKIPPED: ${state.results[file].reason}`);
      await persistState(state);
      await writeSummary(state);
      continue;
    }

    if (existing && !checksumsMatch) {
      console.log(`\nStale checksum detected: ${file}`);
      state.results[file] = {
        ...existing,
        file,
        expected: expectedName,
        status: "stale",
        staleReason: "Checksum changed; reevaluation required.",
        checksums: snapshot.checksums,
        updatedAt: new Date().toISOString(),
      };
      await persistState(state);
      await writeSummary(state);
    }

    console.log(`\nEvaluating: ${file}`);

    if (
      checksumsMatch &&
      existing.status === "partial" &&
      existing.trad &&
      !existing.layered
    ) {
      console.log("  [Layered] Resuming from saved AST result...");
      const layeredCode = await fs.readFile(layeredPath, "utf-8");
      const layeredResult = await evaluateCode(layeredCode, validNames);
      const layeredScore = scoreResult(layeredResult, expectedName);
      console.log(
        `    Result: ${layeredResult.prediction} (Conf: ${layeredResult.confidence_score}%)`,
      );

      state.results[file] = {
        ...existing,
        file,
        expected: expectedName,
        layered: layeredResult,
        layeredScore,
        status: "done",
        checksums: snapshot.checksums,
        updatedAt: new Date().toISOString(),
      };
      await persistState(state);
      await writeSummary(state);
      workCount += 1;
      if (config.delayMs > 0) {
        await delay(config.delayMs);
      }
      continue;
    }

    if (
      checksumsMatch &&
      existing.status === "partial" &&
      existing.trad &&
      existing.layered
    ) {
      state.results[file] = {
        ...existing,
        file,
        expected: expectedName,
        status: "done",
        checksums: snapshot.checksums,
        updatedAt: new Date().toISOString(),
      };
      await persistState(state);
      await writeSummary(state);
      continue;
    }

    const tradCode = await fs.readFile(tradPath, "utf-8");
    console.log("  [AST] Querying AI Gateway...");
    const tradResult = await evaluateCode(tradCode, validNames);
    const tradScore = scoreResult(tradResult, expectedName);
    console.log(
      `    Result: ${tradResult.prediction} (Conf: ${tradResult.confidence_score}%)`,
    );

    state.results[file] = {
      file,
      expected: expectedName,
      trad: tradResult,
      tradScore,
      checksums: snapshot.checksums,
      updatedAt: new Date().toISOString(),
      status: "partial",
    };
    await persistState(state);
    await writeSummary(state);

    const layeredCode = await fs.readFile(layeredPath, "utf-8");
    console.log("  [Layered] Querying AI Gateway...");
    const layeredResult = await evaluateCode(layeredCode, validNames);
    const layeredScore = scoreResult(layeredResult, expectedName);
    console.log(
      `    Result: ${layeredResult.prediction} (Conf: ${layeredResult.confidence_score}%)`,
    );

    state.results[file] = {
      file,
      expected: expectedName,
      trad: tradResult,
      tradScore,
      layered: layeredResult,
      layeredScore,
      status: "done",
      checksums: snapshot.checksums,
      updatedAt: new Date().toISOString(),
    };

    await persistState(state);
    await writeSummary(state);

    workCount += 1;
    if (config.delayMs > 0) {
      await delay(config.delayMs);
    }
  }

  await writeSummary(state);
  console.log(`Evaluated/resumed files this run: ${workCount}`);
  console.log(`\nResults saved to: ${summaryPath}`);
  console.log(`Checkpoint saved to: ${checkpointPath}`);
}

async function evaluateCode(code, validNames) {
  const result = await generateText({
    model: gateway(config.model),
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(code, validNames),
    output: Output.object({
      name: "obfuscated_javascript_classification",
      description: "Classification of an obfuscated JavaScript dataset sample.",
      schema: jsonSchema({
        type: "object",
        additionalProperties: false,
        properties: {
          reasoning: { type: "string" },
          confidence_score: {
            type: "integer",
            minimum: 0,
            maximum: 100,
          },
          prediction: {
            type: "string",
            enum: [...validNames, "UNKNOWN"],
          },
        },
        required: ["reasoning", "confidence_score", "prediction"],
      }),
    }),
    temperature: 0,
    maxOutputTokens: config.maxOutputTokens,
    maxRetries: config.maxRetries,
    timeout: config.timeoutMs,
  });

  try {
    return normalizeResult(result.output, validNames);
  } catch (error) {
    if (!NoOutputGeneratedError.isInstance(error)) {
      throw error;
    }

    const rawText = result.text?.trim();
    if (rawText) {
      console.warn(
        "  -> Structured output was unavailable; parsing the raw model response.",
      );
      return normalizeResult(parseJsonResponse(rawText), validNames);
    }

    const usage = result.totalUsage
      ? ` Usage: ${JSON.stringify(result.totalUsage)}.`
      : "";
    throw new Error(
      `AI Gateway returned no structured output or fallback text (finish reason: ${result.finishReason}).${usage}`,
      { cause: error },
    );
  }
}

function buildPrompt(code, validNames) {
  return [
    "Analyze the following obfuscated JavaScript code.",
    "",
    "Choose exactly one option from the list below:",
    ...validNames.map((name) => `- ${name}`),
    "- UNKNOWN",
    "",
    "Rules:",
    "1. Do not guess. If the logic is unclear, return UNKNOWN.",
    "2. Return raw JSON only.",
    "3. Use the exact file label from the list for prediction.",
    "",
    "Code to analyze:",
    code,
  ].join("\n");
}

function parseJsonResponse(text) {
  const withoutFence = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const objectStart = withoutFence.indexOf("{");
  const objectEnd = withoutFence.lastIndexOf("}");
  const candidate =
    objectStart >= 0 && objectEnd > objectStart
      ? withoutFence.slice(objectStart, objectEnd + 1)
      : withoutFence;

  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new Error(
      `Model returned invalid JSON after structured-output failure: ${text.slice(0, 300)}`,
      { cause: error },
    );
  }
}

function normalizeResult(result, validNames) {
  const prediction =
    typeof result?.prediction === "string" ? result.prediction.trim() : "ERROR";
  const reasoning =
    typeof result?.reasoning === "string" ? result.reasoning.trim() : "";
  const confidence = Number.isFinite(result?.confidence_score)
    ? clampInt(result.confidence_score, 0, 100)
    : 0;

  const normalized = {
    reasoning,
    confidence_score: confidence,
    prediction,
  };

  if (
    ![...validNames, "UNKNOWN"].includes(prediction) ||
    !Number.isFinite(result?.confidence_score)
  ) {
    throw new Error(
      `Model response does not match the evaluation schema: ${JSON.stringify(normalized)}`,
    );
  }

  return normalized;
}

function scoreResult(result, expectedName) {
  return result.prediction === expectedName && result.confidence_score >= 80
    ? 1
    : 0;
}

async function loadState({ manualFiles, validNames, config }) {
  const freshState = createEmptyState({ manualFiles, validNames, config });
  if (forceFresh) {
    await archiveCheckpoint();
    return freshState;
  }
  try {
    const raw = await readCheckpointWithLegacyMigration(config.model);
    const parsed = JSON.parse(raw);
    if (!isCompatibleState(parsed, freshState)) {
      await archiveCheckpoint();
      return freshState;
    }
    return {
      ...freshState,
      ...parsed,
      config: freshState.config,
      results: parsed.results ?? {},
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(
        `Warning: unable to load checkpoint, starting fresh (${error.message}).`,
      );
      await archiveCheckpoint();
    }
    return freshState;
  }
}

async function readCheckpointWithLegacyMigration(model) {
  try {
    return await fs.readFile(checkpointPath, "utf-8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const legacyRaw = await fs.readFile(legacyCheckpointPath, "utf-8");
  const legacyState = JSON.parse(legacyRaw);
  if (legacyState?.config?.model !== model) {
    const error = new Error(
      `Legacy checkpoint belongs to model ${legacyState?.config?.model ?? "UNKNOWN"}.`,
    );
    error.code = "ENOENT";
    throw error;
  }

  await writeTextAtomic(
    checkpointPath,
    `${JSON.stringify(legacyState, null, 2)}\n`,
  );
  console.log(`Migrated matching legacy checkpoint to: ${checkpointPath}`);
  return legacyRaw;
}

function createEmptyState({ manualFiles, validNames, config }) {
  return {
    version: STATE_VERSION,
    config: {
      ...config,
      manualFiles,
      validNames,
    },
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    results: {},
  };
}

function isCompatibleState(existing, fresh) {
  if (
    !existing ||
    !Number.isInteger(existing.version) ||
    existing.version < 2 ||
    existing.version > fresh.version
  ) {
    return false;
  }
  if (
    !existing.config ||
    !Array.isArray(existing.config.manualFiles) ||
    !Array.isArray(existing.config.validNames)
  ) {
    return false;
  }
  return (
    sameArray(existing.config.manualFiles, fresh.config.manualFiles) &&
    sameArray(existing.config.validNames, fresh.config.validNames) &&
    existing.config.model === fresh.config.model &&
    existing.config.promptVersion === fresh.config.promptVersion
  );
}

async function persistState(state) {
  const updatedAt = new Date().toISOString();
  state.updatedAt = updatedAt;
  const snapshot = {
    ...state,
    updatedAt,
  };
  await writeJsonAtomic(checkpointPath, snapshot);
}

async function writeSummary(state) {
  const summary = renderSummary(state);
  await writeTextAtomic(summaryPath, summary);
}

function renderSummary(state) {
  const entries = Object.values(state.results ?? {}).sort((a, b) =>
    a.file.localeCompare(b.file),
  );
  const completed = entries.filter((entry) => entry.status === "done");
  const stale = entries.filter((entry) => entry.status === "stale");
  const skipped = entries.filter((entry) => entry.status === "skipped");
  const pending = (state.config.manualFiles ?? []).filter((file) => {
    const status = state.results[file]?.status;
    return status !== "done" && status !== "skipped";
  });

  const tradCorrect = completed.reduce(
    (acc, entry) => acc + (entry.tradScore ?? 0),
    0,
  );
  const layeredCorrect = completed.reduce(
    (acc, entry) => acc + (entry.layeredScore ?? 0),
    0,
  );
  const tradAccuracy = completed.length
    ? ((tradCorrect / completed.length) * 100).toFixed(2)
    : "0.00";
  const layeredAccuracy = completed.length
    ? ((layeredCorrect / completed.length) * 100).toFixed(2)
    : "0.00";

  let summary = "";
  summary += "# LLM Evaluation Summary\n\n";
  summary += `- Base URL: ${state.config.baseURL}\n`;
  summary += `- Model: ${state.config.model}\n`;
  summary += `- Manual files: ${state.config.manualFiles.length}\n`;
  summary += `- Completed: ${completed.length}\n`;
  summary += `- Stale: ${stale.length}\n`;
  summary += `- Skipped: ${skipped.length}\n`;
  summary += `- Pending: ${pending.length}\n`;
  summary += `- Updated at: ${state.updatedAt ?? new Date().toISOString()}\n\n`;
  summary += `Accuracy (AST-Based): ${tradAccuracy}%\n\n`;
  summary += `Accuracy (Layered): ${layeredAccuracy}%\n\n`;
  summary +=
    "| File | AST Prediction | AST Conf | AST Result | Layered Prediction | Layered Conf | Layered Result | Status |\n";
  summary +=
    "|------|----------------|----------|------------|--------------------|--------------|----------------|--------|\n";

  for (const entry of entries) {
    if (entry.status === "skipped") {
      summary += `| ${entry.file} | N/A | N/A | N/A | N/A | N/A | N/A | SKIPPED |\n`;
      continue;
    }

    const astPrediction = entry.trad?.prediction ?? "N/A";
    const astConfidence =
      entry.trad?.confidence_score != null
        ? `${entry.trad.confidence_score}%`
        : "N/A";
    const astResult =
      entry.status === "stale"
        ? "STALE"
        : entry.tradScore
          ? "PASS"
          : entry.status === "done" || entry.status === "partial"
            ? "FAIL"
            : "N/A";
    const layeredPrediction = entry.layered?.prediction ?? "N/A";
    const layeredConfidence =
      entry.layered?.confidence_score != null
        ? `${entry.layered.confidence_score}%`
        : "N/A";
    const layeredResult =
      entry.status === "stale"
        ? "STALE"
        : entry.layeredScore
          ? "PASS"
          : entry.status === "done"
            ? "FAIL"
            : "N/A";
    summary += `| ${entry.file} | ${astPrediction} | ${astConfidence} | ${astResult} | ${layeredPrediction} | ${layeredConfidence} | ${layeredResult} | ${entry.status.toUpperCase()} |\n`;
  }

  if (pending.length > 0) {
    summary += `\nPending files:\n`;
    for (const file of pending) {
      summary += `- ${file}\n`;
    }
  }

  return summary;
}

async function listDatasetFiles(dir) {
  const files = await fs.readdir(dir);
  return files.filter((file) => file.endsWith(".js")).sort();
}

async function buildFileSnapshot(file) {
  const manualPath = path.join(manualDir, file);
  const tradPath = path.join(tradDir, file);
  const layeredPath = path.join(layeredDir, file);

  const [manualExists, tradExists, layeredExists] = await Promise.all([
    pathExists(manualPath),
    pathExists(tradPath),
    pathExists(layeredPath),
  ]);

  const [manualHash, tradHash, layeredHash] = await Promise.all([
    hashFileIfExists(manualPath, manualExists),
    hashFileIfExists(tradPath, tradExists),
    hashFileIfExists(layeredPath, layeredExists),
  ]);

  return {
    manualPath,
    tradPath,
    layeredPath,
    tradExists,
    layeredExists,
    checksums: {
      manual: manualHash,
      trad: tradHash,
      layered: layeredHash,
    },
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFileIfExists(filePath, exists) {
  if (!exists) {
    return null;
  }
  const content = await fs.readFile(filePath, "utf-8");
  return hashText(content);
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sameChecksums(left, right) {
  return (
    Boolean(left && right) &&
    left.manual === right.manual &&
    left.trad === right.trad &&
    left.layered === right.layered
  );
}

async function writeJsonAtomic(filePath, value) {
  const tmpPath = `${filePath}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(tmpPath, payload, "utf-8");
  await replaceFile(tmpPath, filePath);
}

async function writeTextAtomic(filePath, value) {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, value, "utf-8");
  await replaceFile(tmpPath, filePath);
}

async function replaceFile(tmpPath, filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  await fs.rename(tmpPath, filePath);
}

async function archiveCheckpoint() {
  try {
    await fs.access(checkpointPath);
  } catch {
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archivePath = path.join(
    repoRoot,
    `${resultFileStem}.${stamp}.bak.json`,
  );
  try {
    await replaceFile(checkpointPath, archivePath);
  } catch (error) {
    console.warn(
      `Warning: unable to archive old checkpoint (${error.message}).`,
    );
  }
}

function parsePositiveInt(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function modelFileSlug(model) {
  const slug = model
    .trim()
    .replaceAll("/", "--")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unknown-model";
}

function clampInt(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.min(max, Math.max(min, parsed));
}

function sameArray(left, right) {
  if (
    !Array.isArray(left) ||
    !Array.isArray(right) ||
    left.length !== right.length
  ) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

async function delay(ms) {
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
