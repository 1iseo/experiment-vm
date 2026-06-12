await import(process.env.DATASET_TARGET ?? "../manual/recursive_backtrack.js");
const [f0] = globalThis["__dataset_api__"];
console.log(JSON.stringify(f0(4)));
