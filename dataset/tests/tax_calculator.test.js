await import(process.env.DATASET_TARGET ?? "../manual/tax_calculator.js");
const [f0] = globalThis["__dataset_api__"];
console.log(JSON.stringify({
  tax50m: f0(50000000),
  tax100m: f0(100000000),
  tax1b: f0(1000000000),
}));
