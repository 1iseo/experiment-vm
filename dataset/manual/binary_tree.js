/* @vm-obfuscate */
function f0(node, acc = []) {
  if (node) {
    f0(node.left, acc);
    acc.push(node.val);
    f0(node.right, acc);
  }
  return acc;
}

/* @vm-obfuscate */
function f1(node, acc = []) {
  if (node) {
    acc.push(node.val);
    f1(node.left, acc);
    f1(node.right, acc);
  }
  return acc;
}

/* @vm-obfuscate */
function f2(node, acc = []) {
  if (node) {
    f2(node.left, acc);
    f2(node.right, acc);
    acc.push(node.val);
  }
  return acc;
}

globalThis["__dataset_api__"] = [f0, f1, f2];
