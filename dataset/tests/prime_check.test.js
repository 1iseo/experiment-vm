await import(process.env.DATASET_TARGET ?? "../manual/prime_check.js");
const [f0, f1] = globalThis["__dataset_api__"];
console.log(JSON.stringify({
  check17: f0(17),
  check20: f0(20),
  sieve: f1(30),
}));
