await import(process.env.DATASET_TARGET ?? "../manual/closured_counters.js");
const [f0] = globalThis["__dataset_api__"];
const tracker = f0(10);
console.log(JSON.stringify({
  res1: tracker.increment(),
  res2: tracker.increment(),
  res3: tracker.decrement(),
  res4: tracker.getValue(),
}));
