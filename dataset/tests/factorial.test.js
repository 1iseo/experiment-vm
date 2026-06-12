await import(process.env.DATASET_TARGET ?? "../manual/factorial.js");
const [f0, f1] = globalThis["__dataset_api__"];
console.log(JSON.stringify({
  recursive: f0(8),
  tailRecursive: f1(8),
}));
