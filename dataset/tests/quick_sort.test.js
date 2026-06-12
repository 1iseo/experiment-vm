await import(process.env.DATASET_TARGET ?? "../manual/quick_sort.js");
const [f0] = globalThis["__dataset_api__"];
console.log(JSON.stringify(f0([10, 7, 8, 9, 1, 5])));
