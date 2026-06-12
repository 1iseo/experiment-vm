await import(process.env.DATASET_TARGET ?? "../manual/gcd.js");
const [f0, f1] = globalThis["__dataset_api__"];
console.log(JSON.stringify({
  gcd1: f0(54, 24),
  gcd2: f0(101, 103),
  lcm1: f1(15, 20),
}));
