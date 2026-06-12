import * as parser from "@babel/parser";
import { describe, expect, it } from "vitest";
import {
    GetPropInst,
    IrInvariantChecker,
    SetPropInst,
    StoreInst,
    prettyPrintIRFunction,
    translateFunctionToObfuscatedIR,
} from "../ir_v2.js";
import { lowerIRFunctionToBytecode } from "../ir_lower.js";
import { executeVM } from "../vm.js";
import * as t from "@babel/types";

function getFirstFunction(code: string) {
    const ast = parser.parse(code, { sourceType: "module" });
    const fn = ast.program.body.find(
        (node): node is t.FunctionDeclaration =>
            node.type === "FunctionDeclaration",
    );
    if (!fn) {
        throw new Error("Expected a FunctionDeclaration");
    }
    return fn;
}

function getFirstFunctionScript(code: string) {
    const ast = parser.parse(code, { sourceType: "script" });
    const fn = ast.program.body.find(
        (node): node is t.FunctionDeclaration =>
            node.type === "FunctionDeclaration",
    );
    if (!fn) {
        throw new Error("Expected a FunctionDeclaration");
    }
    return fn;
}

describe("translateFunctionToObfuscatedIR", () => {
    it("handles local variables", () => {
        const fn = getFirstFunction(
            "function demo() { var x = 100; var b = \"yapping\"; var c = [1, 2, 3]; var d = { a: 2}; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn);
        console.log(prettyPrintIRFunction(ir));
        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();
    });

    it("initializes var bindings to undefined", () => {
        const fn = getFirstFunction("function demo() { var x; return x; }");
        const ir = translateFunctionToObfuscatedIR(fn);
        console.log(prettyPrintIRFunction(ir));

        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();
        expect(ir.memLayout.x).toBeDefined();

        const constValues = new Map<string, unknown>();
        for (const inst of entry?.insts ?? []) {
            if (inst.type === "Const") {
                constValues.set(inst.id, inst.value);
            }
        }

        const stores = (entry?.insts.filter(
            (inst): inst is StoreInst => inst.type === "Store",
        ) ?? []);

        const ptrValue = ir.memLayout.x as number;
        const hasUndefinedInit = stores.some((store) =>
            constValues.has(store.ptr) &&
            constValues.has(store.val) &&
            constValues.get(store.ptr) === ptrValue &&
            constValues.get(store.val) === undefined,
        );
        expect(hasUndefinedInit).toBe(true);
    });

    it("rejects let and const declarations", () => {
        const fnLet = getFirstFunction("function demo() { let x = 1; }");
        expect(() => translateFunctionToObfuscatedIR(fnLet))
            .toThrow(/Unsupported variable declaration kind/);

        const fnConst = getFirstFunction("function demo() { const x = 1; }");
        expect(() => translateFunctionToObfuscatedIR(fnConst))
            .toThrow(/Unsupported variable declaration kind/);
    });

    it("maps unknown identifiers to global VM slots", () => {
        const fn = getFirstFunction("function callDemo() { return fetch(1); }");
        const ir = translateFunctionToObfuscatedIR(fn);
        console.log(prettyPrintIRFunction(ir));

        expect(ir.globals).toBeDefined();
        expect(ir.globals?.fetch).toBeDefined();

        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const globalPtr = ir.globals?.fetch as number;
        const constInst = entry?.insts.find(
            (inst) => inst.type === "Const" && inst.value === globalPtr,
        );
        expect(constInst).toBeDefined();

        const loadInst = entry?.insts.find(
            (inst) => inst.type === "Load" && inst.ptr === constInst?.id,
        );
        expect(loadInst).toBeDefined();
    });

    it("lowers unary expressions to UnOp", () => {
        const fn = getFirstFunction("function unaryDemo(a) { return !a; }");
        const ir = translateFunctionToObfuscatedIR(fn);
        console.log(prettyPrintIRFunction(ir));
        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const unop = entry?.insts.find(
            (inst) => inst.type === "UnOp" && inst.op === "!",
        );
        expect(unop).toBeDefined();
    });

    it("lowers assignments to Store", () => {
        const fn = getFirstFunction("function assignDemo(a) { a = 3; return a; }");
        const ir = translateFunctionToObfuscatedIR(fn);
        console.log(prettyPrintIRFunction(ir));
        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const storeInst = entry?.insts.find((inst) => inst.type === "Store");
        expect(storeInst).toBeDefined();
    });

    it("lowers arguments identifier to LoadArgs", () => {
        const fn = getFirstFunction(
            "function demo(a) { return arguments[1]; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn);
        console.log(prettyPrintIRFunction(ir));

        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const loadArgs = entry?.insts.find((inst) => inst.type === "LoadArgs");
        expect(loadArgs).toBeDefined();
        expect(ir.globals?.arguments).toBeUndefined();
    });

    it("maps parameters from args array", () => {
        const fn = getFirstFunction(
            "function demo(a, b) { return a + b; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        console.log(prettyPrintIRFunction(ir));

        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const loadArgs = entry?.insts.find((inst) => inst.type === "LoadArgs");
        expect(loadArgs).toBeDefined();

        const constValues = new Map<string, unknown>();
        for (const inst of entry?.insts ?? []) {
            if (inst.type === "Const") {
                constValues.set(inst.id, inst.value);
            }
        }

        const getProps = (entry?.insts.filter(
            (inst): inst is GetPropInst => inst.type === "GetProp",
        ) ?? []);
        const argIndices = getProps
            .filter((inst) => inst.obj === loadArgs?.id)
            .map((inst) => constValues.get(inst.prop));
        expect(argIndices).toEqual(expect.arrayContaining([0, 1]));

        const stores = entry?.insts.filter((inst) => inst.type === "Store") ?? [];
        const storePtrs = stores.map((inst) => constValues.get(inst.ptr));
        expect(storePtrs).toEqual(expect.arrayContaining([
            ir.memLayout.a,
            ir.memLayout.b,
        ]));
    });

    it("executes bytecode with arguments array", () => {
        const fn = getFirstFunction(
            "function demo(a, b) { return arguments[0] + b; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [10, 5],
            lowered.exceptionTable,
        );

        expect(result).toBe(15);
    });

    it("lowers try/catch with throw", () => {
        const fn = getFirstFunction(
            "function demo() { try { throw 7; } catch (e) { return e; } }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        console.log(prettyPrintIRFunction(ir));

        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const anyCatch = Array.from(ir.blocks.values()).some(
            (block) => block.catchParamPtr !== undefined,
        );
        expect(anyCatch).toBe(true);

        const anyThrow = Array.from(ir.blocks.values()).some((block) =>
            block.insts.some((inst) => inst.type === "Throw"),
        );
        expect(anyThrow).toBe(true);
    });

    it("executes try/catch with explicit throw", () => {
        const fn = getFirstFunction(
            "function demo() { try { throw 7; } catch (e) { return e + 1; } }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [],
            lowered.exceptionTable,
        );
        expect(result).toBe(8);
    });

    it("executes try/catch on implicit TypeError", () => {
        const fn = getFirstFunction(
            "function demo() { try { var x; return x.y; } catch (e) { return 123; } }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [],
            lowered.exceptionTable,
        );
        expect(result).toBe(123);
    });

    it("does not catch exceptions before try", () => {
        const fn = getFirstFunction(
            "function demo() { var x; x.y; try { return 1; } catch (e) { return 2; } }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        expect(() => executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [],
            lowered.exceptionTable,
        )).toThrow();
    });

    it("executes try/finally with normal exit", () => {
        const fn = getFirstFunction(
            "function demo() { var x = 1; try { x = 2; } finally { x = 3; } return x; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [],
            lowered.exceptionTable,
        );
        expect(result).toBe(3);
    });

    it("executes try/finally with throw", () => {
        const fn = getFirstFunction(
            "function demo() { var x = 1; try { try { throw 42; } finally { x = 2; } } catch(e) { return x; } return 0; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [],
            lowered.exceptionTable,
        );
        expect(result).toBe(2);
    });

    it("executes try/finally with return", () => {
        const fn = getFirstFunction(
            "function demo() { var x = 1; try { return x; } finally { x = 2; } }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [],
            lowered.exceptionTable,
        );
        expect(result).toBe(1);
    });

    it("executes try/finally with break", () => {
        const fn = getFirstFunction(
            "function demo() { var x = 1; while (1) { try { break; } finally { x = 2; } } return x; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [],
            lowered.exceptionTable,
        );
        expect(result).toBe(2);
    });

    it("executes try/finally with continue", () => {
        const fn = getFirstFunction(
            "function demo() { var x = 1; var count = 0; while (count < 1) { try { count = count + 1; continue; } finally { x = 2; } } return x; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [],
            lowered.exceptionTable,
        );
        expect(result).toBe(2);
    });

    it("lowers compound assignments for identifiers", () => {
        const ops: Array<[string, string]> = [
            ["+=", "+"],
            ["-=", "-"],
            ["*=", "*"],
            ["/=", "/"],
            ["%=", "%"],
            ["<<=", "<<"],
            [">>=", ">>"],
            [">>>=", ">>>"],
            ["|=", "|"],
            ["^=", "^"],
            ["&=", "&"],
        ];

        for (const [compound, binOp] of ops) {
            const fn = getFirstFunction(
                `function demo() { var x = 1; x ${compound} 2; return x; }`,
            );
            const ir = translateFunctionToObfuscatedIR(fn);
            console.log(prettyPrintIRFunction(ir));

            const entry = ir.blocks.get(ir.entry);
            expect(entry).toBeDefined();

            const bin = entry?.insts.find(
                (inst) => inst.type === "BinOp" && inst.op === binOp,
            );
            expect(bin).toBeDefined();

            const store = entry?.insts.find((inst) => inst.type === "Store");
            expect(store).toBeDefined();
        }
    });

    it("lowers compound assignments for member expressions", () => {
        const fn = getFirstFunction(
            "function demo(obj) { obj.x += 1; return obj.x; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn);
        console.log(prettyPrintIRFunction(ir));

        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const bin = entry?.insts.find(
            (inst) => inst.type === "BinOp" && inst.op === "+",
        );
        expect(bin).toBeDefined();

        const setProp = entry?.insts.find((inst) => inst.type === "SetProp");
        expect(setProp).toBeDefined();
    });

    it("wires Call dependencies for callee and args", () => {
        const fn = getFirstFunction("function callDemo(a) { return a(3); }");
        const ir = translateFunctionToObfuscatedIR(fn);
        console.log(prettyPrintIRFunction(ir));
        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const callInst = entry?.insts.find((inst) => inst.type === "Call");
        expect(callInst).toBeDefined();
        expect(callInst?.deps.length).toBeGreaterThanOrEqual(2);
    });

    it("lowers member reads to GetProp", () => {
        const fn = getFirstFunction("function readDemo(obj) { return obj.x; }");
        const ir = translateFunctionToObfuscatedIR(fn);
        console.log(prettyPrintIRFunction(ir));
        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const getProp = entry?.insts.find((inst) => inst.type === "GetProp");
        expect(getProp).toBeDefined();

        const propConst = entry?.insts.find(
            (inst) => inst.type === "Const" && inst.value === "x",
        );
        expect(propConst).toBeDefined();
    });

    it("lowers computed member reads to GetProp", () => {
        const fn = getFirstFunction(
            "function readComputed(obj, key) { return obj[key]; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn);
        console.log(prettyPrintIRFunction(ir));
        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const getProp = entry?.insts.find((inst) => inst.type === "GetProp");
        expect(getProp).toBeDefined();
    });

    it("lowers member assignments to SetProp", () => {
        const fn = getFirstFunction("function writeDemo(obj) { obj.x = 1; }");
        const ir = translateFunctionToObfuscatedIR(fn);
        console.log(prettyPrintIRFunction(ir));
        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const setProp = entry?.insts.find((inst) => inst.type === "SetProp");
        expect(setProp).toBeDefined();
    });

    it("lowers switch with fallthrough and break", () => {
        const fn = getFirstFunction(
            "function switchDemo(x) { var out = 0; switch (x) { case 1: out = 1; case 2: out = 2; break; default: out = 3; } return out; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn);
        console.log(prettyPrintIRFunction(ir));

        const switchBlock = Array.from(ir.blocks.values()).find(
            (block) => block.term.type === "Switch",
        );
        expect(switchBlock).toBeDefined();

        const caseBlocks = Array.from(ir.blocks.values()).filter((block) =>
            block.id.startsWith("b_case_"),
        );
        expect(caseBlocks.length).toBeGreaterThanOrEqual(2);

        const endBlocks = Array.from(ir.blocks.values()).filter((block) =>
            block.id.startsWith("b_switch_end_"),
        );
        expect(endBlocks.length).toBe(1);

        const endId = endBlocks[0].id;
        const jmpToCase = caseBlocks.some((block) => {
            if (block.term.type !== "Jmp") {
                return false;
            }
            const target = block.term.target;
            return caseBlocks.some((candidate) => candidate.id === target);
        });
        expect(jmpToCase).toBe(true);

        const jmpToEnd = caseBlocks.some((block) =>
            block.term.type === "Jmp" ? block.term.target === endId : false,
        );
        expect(jmpToEnd).toBe(true);
    });

    it("executes numeric switch cases with strict case matching", () => {
        const fn = getFirstFunction(
            "function switchDemo(x) { switch (x) { case 0: return 'zero'; case 1: return 'one'; default: return 'other'; } }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });

        const zero = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [0],
            lowered.exceptionTable,
        );
        const stringZero = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            ["0"],
            lowered.exceptionTable,
        );

        expect(zero).toBe("zero");
        expect(stringZero).toBe("other");
    });

    it("lowers for-in with var", () => {
        const fn = getFirstFunction(
            "function forInDemo(obj) { var count = 0; for (var k in obj) { count = count + 1; } return count; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn);
        console.log(prettyPrintIRFunction(ir));

        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();
    });

    it("lowers array literals to alloc + setprop", () => {
        const fn = getFirstFunction(
            "function arrayDemo() { var arr = [1, 2, 3]; return arr; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        console.log(prettyPrintIRFunction(ir));

        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const alloc = entry?.insts.find((inst) => inst.type === "AllocArray");
        expect(alloc).toBeDefined();

        const setProps = entry?.insts.filter((inst) => inst.type === "SetProp") ?? [];
        expect(setProps.length).toBe(3);
    });

    it("scrambles array initialization deterministically with seed", () => {
        const fn = getFirstFunction("function arrayDemo() { return [getA(), 100]; }");
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        console.log(prettyPrintIRFunction(ir));

        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const constValues = new Map<string, unknown>();
        for (const inst of entry?.insts ?? []) {
            if (inst.type === "Const") {
                constValues.set(inst.id, inst.value);
            }
        }

        const setProps = (entry?.insts.filter(
            (inst): inst is SetPropInst => inst.type === "SetProp",
        ) ?? []);

        const indices = setProps.map((inst) => constValues.get(inst.prop));
        expect(indices).toEqual([1, 0]);
    });

    it("lowers object literals to alloc + setprop", () => {
        const fn = getFirstFunction(
            "function objectDemo() { var obj = { a: 1, b: 2 }; return obj; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        console.log(prettyPrintIRFunction(ir));

        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const alloc = entry?.insts.find((inst) => inst.type === "AllocObject");
        expect(alloc).toBeDefined();

        const setProps = entry?.insts.filter((inst) => inst.type === "SetProp") ?? [];
        expect(setProps.length).toBe(2);
    });

    it("scrambles object initialization deterministically with seed", () => {
        const fn = getFirstFunction("function objectDemo() { return { a: 1, b: 2 }; }");
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        console.log(prettyPrintIRFunction(ir));

        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();

        const constValues = new Map<string, unknown>();
        for (const inst of entry?.insts ?? []) {
            if (inst.type === "Const") {
                constValues.set(inst.id, inst.value);
            }
        }

        const setProps = (entry?.insts.filter(
            (inst): inst is SetPropInst => inst.type === "SetProp",
        ) ?? []);

        const keys = setProps.map((inst) => constValues.get(inst.prop));
        expect(keys).toEqual(["b", "a"]);
    });

    it("lowers getters and setters via VM_INTRINSIC_DEF_PROP", () => {
        const fn = getFirstFunction(
            "function objectDemo() { var obj = { get a() { return 1; }, set b(x) { x = x; } }; return obj; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        console.log(prettyPrintIRFunction(ir));

        const entry = ir.blocks.get(ir.entry);
        expect(entry).toBeDefined();
        expect(ir.globals?.VM_INTRINSIC_DEF_PROP).toBeDefined();

        const calls = entry?.insts.filter((inst) => inst.type === "Call") ?? [];
        expect(calls.length).toBe(2);
    });

    it("lowers debugger statements to Debugger instructions", () => {
        const fn = getFirstFunction("function demo() { debugger; return 1; }");
        const ir = translateFunctionToObfuscatedIR(fn);
        console.log(prettyPrintIRFunction(ir));

        const anyDebugger = Array.from(ir.blocks.values()).some((block) =>
            block.insts.some((inst) => inst.type === "Debugger"),
        );
        expect(anyDebugger).toBe(true);
    });

    it("executes debugger instruction in VM", () => {
        const fn = getFirstFunction("function demo() { debugger; return 42; }");
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [],
            lowered.exceptionTable,
        );

        expect(result).toBe(42);
    });

    it("executes continue in while loops", () => {
        const fn = getFirstFunction(
            "function demo(n) { var i = 0; var out = 0; while (i < n) { i = i + 1; if (i % 2 === 0) { continue; } out = out + i; } return out; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [5],
            lowered.exceptionTable,
        );

        expect(result).toBe(9);
    });

    it("executes continue in for loops", () => {
        const fn = getFirstFunction(
            "function demo(n) { var out = 0; for (var i = 0; i < n; i = i + 1) { if (i === 2) { continue; } out = out + i; } return out; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [5],
            lowered.exceptionTable,
        );

        expect(result).toBe(8);
    });

    it("flattens control flow behind a dispatcher", () => {
        const fn = getFirstFunction(
            "function demo(n) { var out = 0; if (n > 2) { out = 1; } else { out = 2; } while (out < n) { out = out + 1; } switch (out) { case 3: out = out + 10; break; default: out = out + 20; } return out; }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1, flattenCfg: true });

        IrInvariantChecker.check({
            functions: new Map([[ir.id, ir]]),
            globals: ir.globals ?? {},
            entryPoint: ir.id,
        });

        expect(ir.entry.startsWith("b_cfg_entry_")).toBe(true);
        expect(ir.memLayout.__cfg_state).toBeDefined();

        const dispatcher = Array.from(ir.blocks.values()).find(
            (block) => block.id.startsWith("b_cfg_dispatch_"),
        );
        expect(dispatcher?.term.type).toBe("Switch");

        const payloadIds = new Set(
            Array.from(ir.blocks.keys()).filter((id) => !id.startsWith("b_cfg_")),
        );
        expect(payloadIds.size).toBeGreaterThan(1);

        for (const block of ir.blocks.values()) {
            if (block.id === dispatcher?.id) {
                const targets = block.term.type === "Switch"
                    ? [...Object.values(block.term.cases), block.term.defaultTarget]
                    : [];
                expect(targets.some((target) => payloadIds.has(target))).toBe(true);
                continue;
            }

            if (block.term.type === "Jmp") {
                expect(block.term.target).toBe(dispatcher?.id);
            } else if (block.term.type === "Br") {
                expect(block.term.trueTarget.startsWith("b_cfg_set_")).toBe(true);
                expect(block.term.falseTarget.startsWith("b_cfg_set_")).toBe(true);
            } else if (block.term.type === "Switch") {
                for (const target of Object.values(block.term.cases)) {
                    expect(target.startsWith("b_cfg_set_")).toBe(true);
                }
                expect(block.term.defaultTarget.startsWith("b_cfg_set_")).toBe(true);
            }
        }
    });

    it("executes flattened branch, loop, continue, and switch flow", () => {
        const fn = getFirstFunction(
            "function demo(n) { var i = 0; var out = 0; while (i < n) { i = i + 1; if (i === 2) { continue; } out = out + i; } switch (out) { case 4: return out + 1; default: return out; } }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1, flattenCfg: true });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [3],
            lowered.exceptionTable,
        );

        expect(result).toBe(5);
    });

    it("rejects cfg flattening for try/catch flow", () => {
        const fn = getFirstFunction(
            "function demo() { try { throw 1; } catch (e) { return e; } }",
        );

        expect(() => translateFunctionToObfuscatedIR(fn, { seed: 1, flattenCfg: true }))
            .toThrow(/CFG flattening does not support try\/catch\/finally/);
    });

    it("rejects with statements", () => {
        const fn = getFirstFunctionScript(
            "function demo(obj) { with (obj) { a = 1; } }");
        expect(() => translateFunctionToObfuscatedIR(fn))
            .toThrow(/Strict-Mode ES5 Violation/);
    });

    it("executes in and instanceof operators", () => {
        const fn = getFirstFunction(
            "function demo(obj, cls) { return ('x' in obj) && (obj instanceof cls); }",
        );
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        
        class MyClass {}
        const myObj = new MyClass();
        (myObj as any).x = 123;

        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [myObj, MyClass],
            lowered.exceptionTable,
        );
        expect(result).toBe(true);

        const result2 = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [{}, MyClass],
            lowered.exceptionTable,
        );
        expect(result2).toBe(false);
    });

    it("lowers BooleanLiteral", () => {
        const fn = getFirstFunction("function demo() { return true; }");
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [],
            lowered.exceptionTable,
        );
        expect(result).toBe(true);
    });

    it("lowers ThisExpression and executes it via contextThis", () => {
        const fn = getFirstFunction("function demo() { return this; }");
        const ir = translateFunctionToObfuscatedIR(fn, { seed: 1 });
        const lowered = lowerIRFunctionToBytecode(ir, { seed: 1 });
        const dummyThis = { isThis: true };
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            0,
            {},
            undefined,
            [],
            lowered.exceptionTable,
            dummyThis
        );
        expect(result).toBe(dummyThis);
    });
});

import { translateProgramToObfuscatedIR } from "../ir_v2.js";
import { lowerIRProgramToBytecode } from "../ir_lower.js";

describe("translateProgramToObfuscatedIR FunctionExpression", () => {
    it("executes calls to globals supplied by the VM environment", () => {
        const ast = parser.parse(
            "runTestCase(function () { return true; });",
            { sourceType: "script" }
        );
        const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
        const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
        let called = false;
        executeVM(
            lowered.bytecode,
            lowered.constantPool,
            lowered.entryPc,
            {
                runTestCase: (testcase: Function) => {
                    called = testcase() === true;
                },
            },
            1024,
            [],
            lowered.exceptionTable,
        );

        expect(called).toBe(true);
    });

    it("passes VM closures inside descriptor objects to native functions as callables", () => {
        const ast = parser.parse(
            "var obj = {}; Object.defineProperty(obj, 'x', { get: function () { return 3; } }); return obj.x;",
            { sourceType: "script", allowReturnOutsideFunction: true }
        );
        const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
        const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            lowered.entryPc,
            { Object },
            1024,
            [],
            lowered.exceptionTable,
        );

        expect(result).toBe(3);
    });

    it("preserves this for VM closures called as object methods", () => {
        const ast = parser.parse(
            "var obj = { x: 4, f: function () { return this.x; } }; return obj.f();",
            { sourceType: "script", allowReturnOutsideFunction: true }
        );
        const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
        const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            lowered.entryPc,
            {},
            1024,
            [],
            lowered.exceptionTable,
        );

        expect(result).toBe(4);
    });

    it("preserves this for native methods called through member expressions", () => {
        const ast = parser.parse(
            "return 'abc'.replace('a', 'z');",
            { sourceType: "script", allowReturnOutsideFunction: true }
        );
        const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
        const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            lowered.entryPc,
            {},
            1024,
            [],
            lowered.exceptionTable,
        );

        expect(result).toBe("zbc");
    });

    it("executes sequence expressions left to right and returns the last value", () => {
        const ast = parser.parse(
            "var x = 1; return (x = 2, x + 3);",
            { sourceType: "script", allowReturnOutsideFunction: true }
        );
        const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
        const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            lowered.entryPc,
            {},
            1024,
            [],
            lowered.exceptionTable,
        );

        expect(result).toBe(5);
    });

    it("executes programs with more than 255 constants", () => {
        const assignments = Array.from({ length: 300 }, (_, index) => `x = ${index};`).join("");
        const ast = parser.parse(
            `var x = 0; ${assignments} return x;`,
            { sourceType: "script", allowReturnOutsideFunction: true }
        );
        const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
        const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            lowered.entryPc,
            {},
            2048,
            [],
            lowered.exceptionTable,
        );

        expect(lowered.constantPool.length).toBeGreaterThan(255);
        expect(result).toBe(299);
    });

    it("throws TypeError when calling non-function values", () => {
        const ast = parser.parse(
            "var interceptor; return interceptor();",
            { sourceType: "script", allowReturnOutsideFunction: true }
        );
        const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
        const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });

        expect(() => executeVM(
            lowered.bytecode,
            lowered.constantPool,
            lowered.entryPc,
            {},
            1024,
            [],
            lowered.exceptionTable,
        )).toThrow(TypeError);
    });

    it("constructs VM closures with bound this and prototype linkage", () => {
        const ast = parser.parse(
            "function Foo(x) { this.x = x; return 7; } var obj = new Foo(3); if (obj.x !== 3) return false; if (!(obj instanceof Foo)) return false; return obj.constructor === Foo;",
            { sourceType: "script", allowReturnOutsideFunction: true }
        );
        const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
        const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            lowered.entryPc,
            {},
            1024,
            [],
            lowered.exceptionTable,
        );

        expect(result).toBe(true);
    });

    it("keeps VM object internals independent from the ambient Object global", () => {
        const ast = parser.parse(
            "function Foo() {} var f = function () { return 1; }; return f();",
            { sourceType: "script", allowReturnOutsideFunction: true }
        );
        const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
        const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
        const originalObject = globalThis.Object;
        let result: unknown;

        try {
            (globalThis as typeof globalThis & { Object: unknown }).Object = function ShadowObject() {};
            result = executeVM(
                lowered.bytecode,
                lowered.constantPool,
                lowered.entryPc,
                {},
                1024,
                [],
                lowered.exceptionTable,
            );
        } finally {
            (globalThis as typeof globalThis & { Object: unknown }).Object = originalObject;
        }

        expect(result).toBe(1);
    });

    it("honors object return override for VM constructors", () => {
        const ast = parser.parse(
            "function Foo() { this.x = 1; return { x: 2 }; } return new Foo().x;",
            { sourceType: "script", allowReturnOutsideFunction: true }
        );
        const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
        const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            lowered.entryPc,
            {},
            1024,
            [],
            lowered.exceptionTable,
        );

        expect(result).toBe(2);
    });

    it("falls back to Object.prototype for non-object VM constructor prototypes", () => {
        const ast = parser.parse(
            "function Foo() {} Foo.prototype = 1; var obj = new Foo(); return Object.getPrototypeOf(obj) === Object.prototype;",
            { sourceType: "script", allowReturnOutsideFunction: true }
        );
        const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
        const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            lowered.entryPc,
            { Object },
            1024,
            [],
            lowered.exceptionTable,
        );

        expect(result).toBe(true);
    });

    it("constructs native constructors with arguments", () => {
        const ast = parser.parse(
            "var d = new Date(0); return d.getTime();",
            { sourceType: "script", allowReturnOutsideFunction: true }
        );
        const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
        const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            lowered.entryPc,
            { Date },
            1024,
            [],
            lowered.exceptionTable,
        );

        expect(result).toBe(0);
    });

    it("executes FunctionExpression and captures variables", () => {
        const ast = parser.parse(
            "var x = 100; var y = 10; var f = function(z) { return x + y + z; }; return f(5);",
            { sourceType: "script", allowReturnOutsideFunction: true }
        );
        const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
        const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            lowered.entryPc,
            {},
            1024,
            [],
            lowered.exceptionTable,
        );
        // x = 100, y = 10, z = 5 => 115
        expect(result).toBe(115);
    });

    it("executes Named Function Expression with self-reference", () => {
        const ast = parser.parse(
            "var f = function fact(n) { if (n <= 1) { return 1; } return n * fact(n - 1); }; return f(5);",
            { sourceType: "script", allowReturnOutsideFunction: true }
        );
        const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
        const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
        const result = executeVM(
            lowered.bytecode,
            lowered.constantPool,
            lowered.entryPc,
            {},
            1024,
            [],
            lowered.exceptionTable,
        );
        // 5! = 120
        expect(result).toBe(120);
    });
});
