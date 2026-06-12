/* @vm-obfuscate */
function isPrime(n) {
  if (n <= 1) return false;
  if (n <= 3) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

/* @vm-obfuscate */
function sieveOfEratosthenes(max) {
  const isPrimeArr = new Array(max + 1).fill(true);
  isPrimeArr[0] = false;
  isPrimeArr[1] = false;
  for (let p = 2; p * p <= max; p++) {
    if (isPrimeArr[p]) {
      for (let i = p * p; i <= max; i += p) {
        isPrimeArr[i] = false;
      }
    }
  }
  const primes = [];
  for (let i = 2; i <= max; i++) {
    if (isPrimeArr[i]) primes.push(i);
  }
  return primes;
}

globalThis["__dataset_api__"] = [isPrime, sieveOfEratosthenes];
