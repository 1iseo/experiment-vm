await import(process.env.DATASET_TARGET ?? "../manual/try_catch_flow.js");
const [f0] = globalThis["__dataset_api__"];
console.log(JSON.stringify({
  res1: f0('{"x":10,"y":2}'),
  res2: f0('{"x":10,"y":0}'),
  res3: f0('{"x":10,"y":"not-a-number"}'),
  res4: f0("invalid-json"),
}));
