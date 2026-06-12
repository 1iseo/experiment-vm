await import(process.env.DATASET_TARGET ?? "../manual/merge_sort.js");
const [f0] = globalThis["__dataset_api__"];
console.log(JSON.stringify(f0([12, 11, 13, 5, 6, 7])));
