await import(process.env.DATASET_TARGET ?? "../manual/bubble_sort.js");
const [f0] = globalThis["__dataset_api__"];
console.log(JSON.stringify(f0([64, 34, 25, 12, 22, 11, 90])));
