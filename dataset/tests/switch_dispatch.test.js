await import(process.env.DATASET_TARGET ?? "../manual/switch_dispatch.js");
const [f0] = globalThis["__dataset_api__"];
const value = [
  { type: "START" },
  { op: "ADD", val: 5 },
  { op: "MUL", val: 3 },
  { op: "PAUSE" },
  { op: "ADD", val: 10 },
  { type: "RESUME" },
  { op: "SUB", val: 2 },
  { op: "STOP" },
  { op: "ADD", val: 100 },
];
console.log(JSON.stringify(f0(value)));
