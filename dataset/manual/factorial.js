/* @vm-obfuscate */
function factorialRecursive(n) {
  if (n <= 1) return 1;
  return n * factorialRecursive(n - 1);
}

/* @vm-obfuscate */
function factorialTailRecursive(n, accumulator = 1) {
  if (n <= 1) return accumulator;
  return factorialTailRecursive(n - 1, n * accumulator);
}

globalThis["__dataset_api__"] = [
  factorialRecursive,
  factorialTailRecursive,
];
