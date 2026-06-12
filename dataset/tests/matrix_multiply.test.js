await import(process.env.DATASET_TARGET ?? "../manual/matrix_multiply.js");
const [f0] = globalThis["__dataset_api__"];
console.log(JSON.stringify(f0(
  [[1, 2], [3, 4]],
  [[5, 6], [7, 8]],
)));
