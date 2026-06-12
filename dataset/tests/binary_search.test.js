await import(process.env.DATASET_TARGET ?? "../manual/binary_search.js");
const [f0, f1] = globalThis["__dataset_api__"];
const values = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29];
const targets = [2, 13, 29, 100];
const results = [];
for (const target of targets) {
  results.push(f0(values, target));
  results.push(f1(values, target, 0, values.length - 1));
}
console.log(JSON.stringify(results));
