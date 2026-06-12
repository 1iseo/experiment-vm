/* @vm-obfuscate */
function fibonacciIterative(n) {
  const result = [0, 1];
  for (let i = 2; i <= n; i++) {
    result.push(result[i - 1] + result[i - 2]);
  }
  return result.slice(0, n + 1);
}

/* @vm-obfuscate */
function fibonacciRecursive(n) {
  if (n <= 1) return n;
  return fibonacciRecursive(n - 1) + fibonacciRecursive(n - 2);
}

/* @vm-obfuscate */
function makeMemoizedFibonacci() {
  const memo = {};
  function f(n) {
    if (n in memo) return memo[n];
    if (n <= 1) return n;
    memo[n] = f(n - 1) + f(n - 2);
    return memo[n];
  }
  return f;
}

globalThis["__dataset_api__"] = [
  fibonacciIterative,
  fibonacciRecursive,
  makeMemoizedFibonacci,
];
