import * as parser from "@babel/parser";
import {
  translateProgramToObfuscatedIR,
  prettyPrintIRFunction,
} from "./ir_v2.js";
import { lowerIRProgramToBytecode } from "./ir_lower.js";
import { executeVM } from "./vm.js";

const ast = parser.parse(
  `var a = 12;
  var calculateSquareRoot = function calculateSquareRoot(x) {
    return x * x;
  };
  function yomama(a) {
    var c = 500;
    return c * a
  }
  function main() {
    console.log("Hello!");
    console.log("Square root of " + a + " is " + calculateSquareRoot(a));
    var res = yomama(90);
    console.log(res);
    return res;
  }
  main();`,
  { sourceType: "script", allowReturnOutsideFunction: true },
);

const irProgram = translateProgramToObfuscatedIR(ast.program, { seed: 1 });
console.log(irProgram.functions.values());
for (const fn of irProgram.functions.values()) {
  console.log(`\n=== FUNCTION: ${fn.id} ===`);
  console.log("MemLayout:", fn.memLayout);
  console.log(prettyPrintIRFunction(fn));
}

const lowered = lowerIRProgramToBytecode(irProgram, { seed: 1 });
console.log(lowered.bytecode);
console.log("Executing...");
const result = executeVM(
  lowered.bytecode,
  lowered.constantPool,
  lowered.entryPc,
  {
    console: console,
  },
  1024,
  [],
  lowered.exceptionTable,
);
console.log("Result:", result);
