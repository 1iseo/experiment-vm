await import(process.env.DATASET_TARGET ?? "../manual/fibonacci.js");
const [f0, f1, f2] = globalThis["__dataset_api__"];
const memoized = f2();
console.log(JSON.stringify({
  iterative: f0(10),
  recursive: f1(10),
  memoized: memoized(10),
}));
