import * as parser from "@babel/parser";
import { translateProgramToObfuscatedIR, prettyPrintIRFunction } from "./ir_v2.js";
import { lowerIRProgramToBytecode } from "./ir_lower.js";
import { executeVM } from "./vm.js";

const ast = parser.parse(
    "var x = 100; var y = 10; var f = function(z) { return x + y + z; }; return f(5);",
    { sourceType: "script", allowReturnOutsideFunction: true }
);

const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
for (const fn of Object.values(irProgram.functions)) {
    console.log(`\n=== FUNCTION: ${fn.id} ===`);
    console.log("MemLayout:", fn.memLayout);
    console.log(prettyPrintIRFunction(fn));
}

const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
console.log("Executing...");
const result = executeVM(
    lowered.bytecode,
    lowered.constantPool,
    lowered.entryPc,
    {},
    1024,
    [],
    lowered.exceptionTable,
);
console.log("Result:", result);
