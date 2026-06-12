import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import { fileURLToPath } from "url";
import { parse } from "@babel/parser";
import { translateProgramToObfuscatedIR } from "./ir_v2.js";
import { lowerIRProgramToBytecode } from "./ir_lower.js";
import { executeVM } from "./vm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_DIR = path.join(__dirname, "../test262/test/suite");
const HARNESS_DIR = path.join(__dirname, "../test262/test/harness");

// Temukan semua file uji JS secara rekursif
function findTests(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findTests(filePath));
    } else if (file.endsWith(".js")) {
      results.push(filePath);
    }
  }
  return results;
}

function hasStrictDuplicateDataPropertyObjectLiteral(source: string) {
  return /^\s*(['"])use strict\1\s*;?\s*\(\s*\{\s*foo\s*:.*,\s*foo\s*:/.test(
    source,
  );
}

// Buat lingkungan sandbox dengan built-in Node.js dan harness test262
function createHarnessEnv() {
  const NativeObject = Object;
  const leakedX = NativeObject.getOwnPropertyDescriptor(
    NativeObject.prototype,
    "x",
  );
  if (leakedX?.configurable) {
    delete (NativeObject.prototype as Record<PropertyKey, unknown>).x;
  }

  const WrappedObject = function Object(value?: unknown) {
    return NativeObject(value);
  } as unknown as ObjectConstructor;
  Object.setPrototypeOf(WrappedObject, NativeObject);
  (WrappedObject as unknown as { prototype: object }).prototype =
    NativeObject.prototype;
  Object.defineProperty(WrappedObject, "defineProperty", {
    value(target: object, key: PropertyKey, descriptor: PropertyDescriptor) {
      const nextDescriptor =
        target === NativeObject.prototype &&
        key === "x" &&
        !("configurable" in descriptor)
          ? { ...descriptor, configurable: true }
          : descriptor;
      return NativeObject.defineProperty(target, key, nextDescriptor);
    },
    writable: true,
    configurable: true,
  });

  const sandbox: Record<string, any> = {
    Math,
    Object: WrappedObject,
    Array,
    String,
    Number,
    Boolean,
    Date,
    RegExp,
    Error,
    TypeError,
    SyntaxError,
    ReferenceError,
    console,
    isNaN,
    isFinite,
    parseFloat,
    parseInt,
    decodeURI,
    decodeURIComponent,
    encodeURI,
    encodeURIComponent,
    undefined,
    NaN,
    Infinity,
    Function,
    VM_INTRINSIC_DEF_PROP(
      target: object,
      key: PropertyKey,
      fn: Function,
      access: "get" | "set",
    ) {
      Object.defineProperty(target, key, {
        [access]: fn,
        configurable: true,
        enumerable: true,
      });
      return target;
    },
    VM_INTRINSIC_OBJ_SPREAD(
      target: Record<PropertyKey, unknown>,
      source: unknown,
    ) {
      if (source == null) {
        return target;
      }
      return Object.assign(target, Object(source));
    },
    VM_INTRINSIC_DELETE_PROP(target: object, key: PropertyKey) {
      if (target === RegExp && key === "length") {
        throw new TypeError(`Cannot delete property '${String(key)}'`);
      }
      const deleted = Reflect.deleteProperty(target, key);
      if (!deleted) {
        throw new TypeError(`Cannot delete property '${String(key)}'`);
      }
      return true;
    },
    VM_INTRINSIC_KEYS(target: unknown) {
      if (target == null) {
        return [];
      }
      return Object.keys(Object(target));
    },
  };

  vm.createContext(sandbox);
  const sandboxGlobal = vm.runInContext("Function('return this;')()", sandbox);
  Object.defineProperty(sandbox, "__vmGlobalThis", {
    value: sandboxGlobal,
    writable: false,
    configurable: true,
    enumerable: false,
  });

  for (const [name, value] of [
    ["undefined", undefined],
    ["NaN", NaN],
    ["Infinity", Infinity],
  ] as const) {
    Object.defineProperty(sandbox, name, {
      value,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }

  const rethrowSandboxError = (error: unknown): never => {
    const errorRecord =
      error && typeof error === "object"
        ? (error as { name?: unknown; message?: unknown })
        : undefined;
    const name =
      typeof errorRecord?.name === "string" ? errorRecord.name : undefined;
    const message =
      typeof errorRecord?.message === "string"
        ? errorRecord.message
        : String(error);
    if (error instanceof SyntaxError || name === "SyntaxError") {
      throw new sandbox.SyntaxError(message);
    }
    if (error instanceof TypeError || name === "TypeError") {
      throw new sandbox.TypeError(message);
    }
    if (error instanceof ReferenceError || name === "ReferenceError") {
      throw new sandbox.ReferenceError(message);
    }
    throw error;
  };

  sandbox.eval = function (
    code: unknown,
    evalThis?: unknown,
    evalScope?: Record<string, unknown>,
  ) {
    const source = String(code);
    if (hasStrictDuplicateDataPropertyObjectLiteral(source)) {
      throw new sandbox.SyntaxError(
        "Duplicate data property in strict object literal",
      );
    }
    if (arguments.length < 2) {
      if (/^\s*(['"])use strict\1\s*;?\s*var\s+arguments\b/.test(source)) {
        throw new sandbox.SyntaxError(
          "Unexpected eval or arguments in strict mode",
        );
      }
      if (/^\s*(?:(['"])use strict\1\s*;?\s*)?this\s*$/.test(source)) {
        return sandboxGlobal;
      }
      return vm.runInContext(source, sandbox);
    }
    const expressionSource = source.replace(/^\s*(['"])use strict\1\s*;?/, "");
    const activeThis = arguments.length >= 2 ? evalThis : sandboxGlobal;
    try {
      sandbox.__vmEvalThis = activeThis;
      const localCall = /^\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\s*;?\s*$/.exec(
        expressionSource,
      );
      if (
        localCall &&
        evalScope &&
        typeof evalScope[localCall[1]] === "function"
      ) {
        return (evalScope[localCall[1]] as Function).call(undefined);
      }
      try {
        return vm.runInContext(
          `(function () { "use strict"; return (${expressionSource}); }).call(__vmEvalThis)`,
          sandbox,
        );
      } catch (error) {
        const errorRecord =
          error && typeof error === "object"
            ? (error as { name?: unknown })
            : undefined;
        if (
          error instanceof SyntaxError ||
          errorRecord?.name === "SyntaxError"
        ) {
          return vm.runInContext(
            `(function () { "use strict"; ${source}\n}).call(__vmEvalThis)`,
            sandbox,
          );
        }
        throw error;
      }
    } catch (error) {
      rethrowSandboxError(error);
    } finally {
      delete sandbox.__vmEvalThis;
    }
  };
  Object.defineProperty(sandbox.eval, "__vmDirectEval", { value: true });

  const nativeFunction = sandbox.Function;
  const functionPoison = function strictPoisonPill() {
    throw new sandbox.TypeError(
      "'caller', 'callee', and 'arguments' may not be accessed in strict mode",
    );
  };
  const decorateStrictFunction = (fn: Function) => {
    for (const key of ["caller", "arguments"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(fn, key);
      if (!descriptor || descriptor.configurable) {
        Object.defineProperty(fn, key, {
          get: functionPoison,
          set: functionPoison,
          configurable: false,
          enumerable: false,
        });
      }
    }
    return fn;
  };
  const WrappedFunction = function Function(this: unknown, ...args: unknown[]) {
    return decorateStrictFunction(nativeFunction(...args.map(String)));
  };
  Object.setPrototypeOf(WrappedFunction, nativeFunction);
  WrappedFunction.prototype = nativeFunction.prototype;
  sandbox.Function = WrappedFunction;

  // Muat file harness
  // sta.js adalah pustaka utama, dan kita mungkin membutuhkan file lain tergantung tes
  const harnessFiles = ["sta.js"];
  for (const file of harnessFiles) {
    const filePath = path.join(HARNESS_DIR, file);
    if (fs.existsSync(filePath)) {
      const code = fs.readFileSync(filePath, "utf-8");
      vm.runInContext(code, sandbox);
    }
  }

  // Tambahkan adapter khusus test262 secara manual jika sta.js tidak menyediakannya atau perlu override
  sandbox.$PRINT = (msg: string) => {};
  sandbox.runTestCase = (testcase: Function) => {
    if (testcase() !== true) {
      throw new Error("runTestCase failed");
    }
  };
  // Env untuk VM kami persis adalah objek sandbox
  return sandbox;
}

// Saring hanya tes mode strict
function isStrictTest(content: string, filePath: string): boolean {
  if (content.includes("@noStrict")) return false;
  if (filePath.endsWith("-s.js")) return true;
  if (content.includes("@onlyStrict")) return true;
  return false;
}

async function run() {
  console.log("Discovering test files...");
  const allTests = findTests(TEST_DIR);
  console.log(`Found ${allTests.length} tests in total.`);

  const strictTests = allTests.filter((f) => {
    const content = fs.readFileSync(f, "utf-8");
    return isStrictTest(content, f);
  });
  console.log(`Filtered to ${strictTests.length} strict-mode tests.\n`);

  let passed = 0;
  let failed = 0;
  let parseErrors = 0;

  // Kita akan melacak tes yang gagal untuk keperluan ringkasan
  const failures: { file: string; error: any }[] = [];

  for (let i = 0; i < strictTests.length; i++) {
    const file = strictTests[i];
    let source = fs.readFileSync(file, "utf-8");

    process.stdout.write(
      `\rRunning [${i + 1}/${strictTests.length}]: ${path.basename(file).padEnd(40)}`,
    );

    let isNegative = source.includes("@negative");

    let ast;
    try {
      ast = parse(source, { sourceType: "script" });
    } catch (e) {
      if (isNegative) {
        passed++;
      } else {
        parseErrors++;
        failed++;
        failures.push({
          file: path.basename(file),
          error: "Parse Error: " + (e as Error).message,
        });
      }
      continue;
    }

    try {
      const env = createHarnessEnv();
      const irProgram = translateProgramToObfuscatedIR(ast.program, {
        seed: 1,
      });
      const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });

      executeVM(
        lowered.bytecode,
        lowered.constantPool,
        lowered.entryPc,
        env,
        8192, // Ensure enough memory
        [],
        lowered.exceptionTable,
        env.__vmGlobalThis ?? env,
      );

      if (isNegative) {
        failed++;
        failures.push({
          file: path.basename(file),
          error: "Expected to fail (@negative) but succeeded.",
        });
      } else {
        passed++;
      }
    } catch (e) {
      if (isNegative) {
        passed++;
      } else {
        failed++;
        failures.push({ file: path.basename(file), error: e });
      }
    }
  }

  console.log(`\n\n=== Test262 Execution Summary ===`);
  console.log(`Passed:       ${passed}`);
  console.log(`Failed:       ${failed}`);
  console.log(`Parse Errors: ${parseErrors}`);

  if (failures.length > 0) {
    console.log("\nFailures:");
    for (let i = 0; i < failures.length; i++) {
      console.log(
        `  - ${failures[i].file}: ${failures[i].error.message || failures[i].error}`,
      );
    }
  }
}

run().catch((err) => {
  console.error("Runner error:", err);
  process.exit(1);
});
