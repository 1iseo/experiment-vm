import { describe, expect, it } from "vitest";
import { executeVM } from "@experiment-vm/vm";
import { transformSource } from "../index.js";

function runTransformed(code: string): unknown {
  const runnable = code.replace(
    /import \{ executeVM as ([^ }]+) \} from "@experiment-vm\/vm";/,
    "const $1 = executeVM;",
  );
  return new Function("executeVM", `${runnable}\nreturn result;`)(executeVM);
}

describe("transformSource", () => {
  it("returns null when no functions are marked", () => {
    expect(transformSource("function add(a, b) { return a + b; }")).toBeNull();
  });

  it("obfuscates a leading-comment function declaration", () => {
    const result = transformSource(`
      /* @vm-obfuscate */
      function add(a, b) { return a + b; }
      var result = add(2, 3);
    `);

    expect(result?.obfuscatedFunctions).toBe(1);
    expect(result?.code).toContain("__vm_obfuscator_payloads");
    expect(runTransformed(result!.code)).toBe(5);
  });

  it("passes captured module bindings into the VM environment", () => {
    const result = transformSource(`
      var base = 10;
      /* @vm-obfuscate */
      function add(x) { return base + x; }
      var result = add(5);
    `);

    expect(result?.obfuscatedFunctions).toBe(1);
    expect(runTransformed(result!.code)).toBe(15);
  });

  it("aliases captured environment keys and encodes numeric constants", () => {
    const result = transformSource(`
      function semanticHelper(value) { return value + 1; }
      /* @vm-obfuscate */
      function calculate(value) { return semanticHelper(value) * 0.05; }
      var result = calculate(19);
    `, "input.js", {
      inlineRuntime: true,
      renameInternalNames: true,
      seed: 1234,
    });

    expect(result?.obfuscatedFunctions).toBe(1);
    expect(result?.code).not.toMatch(/["']semanticHelper["']/);
    expect(result?.code).not.toContain("0.05");
    expect(runTransformed(result!.code)).toBe(1);
  });

  it("keeps captured writes isolated in snapshot capture mode", () => {
    const result = transformSource(`
      var counter = 0;
      /* @vm-obfuscate */
      function bump() { counter = counter + 1; return counter; }
      var inner = bump();
      var result = [inner, counter];
    `);

    expect(result?.obfuscatedFunctions).toBe(1);
    expect(runTransformed(result!.code)).toEqual([1, 0]);
  });

  it("writes back to captured ES5 bindings in live capture mode", () => {
    const result = transformSource(`
      var counter = 0;
      /* @vm-obfuscate */
      function bump() { counter = counter + 1; return counter; }
      var inner = bump();
      var result = [inner, counter];
    `, "input.js", { captureMode: "live" });

    expect(result?.obfuscatedFunctions).toBe(1);
    expect(runTransformed(result!.code)).toEqual([1, 1]);
  });

  it("preserves named recursion inside an obfuscated function", () => {
    const result = transformSource(`
      /* @vm-obfuscate */
      function fact(n) { if (n <= 1) { return 1; } return n * fact(n - 1); }
      var result = fact(5);
    `);

    expect(result?.obfuscatedFunctions).toBe(1);
    expect(runTransformed(result!.code)).toBe(120);
  });

  it("passes the call receiver as VM this", () => {
    const result = transformSource(`
      var obj = {
        x: 7,
        f: /* @vm-obfuscate */ function (n) { return this.x + n; }
      };
      var result = obj.f(4);
    `);

    expect(result?.obfuscatedFunctions).toBe(1);
    expect(runTransformed(result!.code)).toBe(11);
  });

  it("obfuscates marked function expressions and leaves unmarked functions alone", () => {
    const result = transformSource(`
      var plain = function (x) { return x + 1; };
      var secret = /* @vm-obfuscate */ function (x) { return x * 2; };
      var result = plain(secret(4));
    `);

    expect(result?.obfuscatedFunctions).toBe(1);
    expect(runTransformed(result!.code)).toBe(9);
  });

  it("serializes RegExp constants used inside obfuscated functions", () => {
    const result = transformSource(`
      var source = { keys: { IE_PROTO: "Symbol(src)_1.test" } };
      var result = (/* @vm-obfuscate */ function () {
        var uid = /[^.]+$/.exec(source && source.keys && source.keys.IE_PROTO || "");
        return uid ? ("Symbol(src)_1." + uid) : "";
      }());
    `, "input.js", { captureMode: "live" });

    expect(result?.obfuscatedFunctions).toBe(1);
    expect(runTransformed(result!.code)).toBe("Symbol(src)_1.test");
  });

  it("provides VM intrinsics required by lowered for-in loops", () => {
    const result = transformSource(`
      var result = (/* @vm-obfuscate */ function (object) {
        var count = 0;
        for (var key in object) {
          count += 1;
        }
        return count;
      }({ a: 1, b: 2 }));
    `);

    expect(result?.obfuscatedFunctions).toBe(1);
    expect(runTransformed(result!.code)).toBe(2);
  });

  it("executes obfuscated async function declarations after ES5 lowering", async () => {
    const result = transformSource(`
      /* @vm-obfuscate */
      async function doubleAfterResolve(x) {
        var y = await Promise.resolve(x + 1);
        return y * 2;
      }
      var result = doubleAfterResolve(2);
    `);

    expect(result?.obfuscatedFunctions).toBe(1);
    await expect(runTransformed(result!.code) as Promise<unknown>).resolves.toBe(6);
  });

  it("executes obfuscated async function expressions and arrows", async () => {
    const expression = transformSource(`
      var doubleAfterResolve = /* @vm-obfuscate */ async function (x) {
        var y = await Promise.resolve(x + 1);
        return y * 2;
      };
      var result = doubleAfterResolve(3);
    `);
    const arrow = transformSource(`
      var doubleAfterResolve = /* @vm-obfuscate */ async (x) => {
        var y = await Promise.resolve(x + 1);
        return y * 2;
      };
      var result = doubleAfterResolve(4);
    `);

    expect(expression?.obfuscatedFunctions).toBe(1);
    expect(arrow?.obfuscatedFunctions).toBe(1);
    await expect(runTransformed(expression!.code) as Promise<unknown>).resolves.toBe(8);
    await expect(runTransformed(arrow!.code) as Promise<unknown>).resolves.toBe(10);
  });

  it("preserves this for obfuscated async object methods", async () => {
    const result = transformSource(`
      var obj = {
        x: 7,
        /* @vm-obfuscate */
        async addAfterResolve(n) {
          var y = await Promise.resolve(n);
          return this.x + y;
        }
      };
      var result = obj.addAfterResolve(5);
    `);

    expect(result?.obfuscatedFunctions).toBe(1);
    await expect(runTransformed(result!.code) as Promise<unknown>).resolves.toBe(12);
  });

  it("returns native promises from obfuscated functions", async () => {
    const result = transformSource(`
      var result = (/* @vm-obfuscate */ function (x) {
        return Promise.resolve(x + 1).then(function (y) {
          return y * 2;
        });
      }(5));
    `);

    expect(result?.obfuscatedFunctions).toBe(1);
    await expect(runTransformed(result!.code) as Promise<unknown>).resolves.toBe(12);
  });

  it("rejects marked generator functions before Babel lowering", () => {
    expect(() => transformSource(`
      /* @vm-obfuscate */
      function* values() {
        yield 1;
      }
      var result = values().next().value;
    `)).toThrow(/Generator functions are not supported/);
  });
});
