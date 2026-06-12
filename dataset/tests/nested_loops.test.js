await import(process.env.DATASET_TARGET ?? "../manual/nested_loops.js");
const [f0] = globalThis["__dataset_api__"];
const grid = [
  [1, 0, 1, 0],
  [0, 1, 0, 1],
  [1, 0, 1, 0],
  [0, 1, 0, 1],
];
console.log(JSON.stringify(f0(grid, [[1, 0], [0, 1]])));
