#!/usr/bin/env node
import { exec } from "node:child_process";
import { readdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const datasetDir = path.join(repoRoot, "dataset", "manual");
const bundlerDist = path.join(repoRoot, "packages", "bundler-plugin", "dist", "index.js");

async function runCommand(cmd, cwd) {
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd });
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return { success: false, stdout: error.stdout?.trim() || "", stderr: error.stderr?.trim() || error.message };
  }
}

async function main() {
  console.log("=== VM Obfuscator Dataset Test Runner ===");

  console.log("Building packages...");
  const buildResult = await runCommand("pnpm build", repoRoot);
  if (!buildResult.success) {
    console.error("Build failed:", buildResult.stderr);
    process.exit(1);
  }
  console.log("Build successful.\n");

  const { transformSource } = await import(pathToFileURL(bundlerDist).href);

  let files;
  try {
    files = (await readdir(datasetDir)).filter(file => file.endsWith(".js") && !file.includes(".obfuscated.js"));
  } catch (error) {
    console.error(`Error reading dataset directory: ${error.message}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} test files in dataset/manual/.\n`);

  let passed = 0;
  let failed = 0;

  for (const file of files) {
    const originalPath = path.join(datasetDir, file);
    const obfuscatedPath = path.join(datasetDir, file.replace(".js", ".obfuscated.js"));

    process.stdout.write(`Testing ${file}... `);

    const baseline = await runCommand(`node ${file}`, datasetDir);
    if (!baseline.success) {
      console.log("FAIL (Original code error)");
      console.error(baseline.stderr);
      failed++;
      continue;
    }

    const originalSource = await readFile(originalPath, "utf-8");

    try {

      const result = transformSource(originalSource, originalPath, {
        runtimeImport: "../../packages/vm/dist/index.js",
        seed: 42
      });

      if (!result || !result.code) {
        console.log("FAIL (Transformation returned empty code)");
        failed++;
        continue;
      }

      await writeFile(obfuscatedPath, result.code, "utf-8");

      const obfRun = await runCommand(`node ${path.basename(obfuscatedPath)}`, datasetDir);
      

      await rm(obfuscatedPath, { force: true });

      if (!obfRun.success) {
        console.log("FAIL (Obfuscated code crashed)");
        console.error(obfRun.stderr);
        failed++;
        continue;
      }

      if (areOutputsEquivalent(obfRun.stdout, baseline.stdout)) {
        console.log("PASS");
        passed++;
      } else {
        console.log("FAIL (Output mismatch)");
        console.log(`  Expected: ${baseline.stdout}`);
        console.log(`  Actual:   ${obfRun.stdout}`);
        failed++;
      }
    } catch (err) {
      console.log("FAIL (Obfuscator compiler error)");
      console.error(err);
      failed++;

      await rm(obfuscatedPath, { force: true });
    }
  }

  console.log(`\n=== Test Summary ===`);
  console.log(`Total:  ${files.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

function areOutputsEquivalent(out1, out2) {
  const lines1 = out1.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const lines2 = out2.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  
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

main();
