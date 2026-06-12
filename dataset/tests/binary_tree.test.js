await import(process.env.DATASET_TARGET ?? "../manual/binary_tree.js");
const [f0, f1, f2] = globalThis["__dataset_api__"];
const value = {
  val: 1,
  left: {
    val: 2,
    left: { val: 4, left: null, right: null },
    right: { val: 5, left: null, right: null },
  },
  right: { val: 3, left: null, right: null },
};
console.log(JSON.stringify({
  inOrder: f0(value),
  preOrder: f1(value),
  postOrder: f2(value),
}));
