await import(process.env.DATASET_TARGET ?? "../manual/callback_queue.js");
const [f0, f1] = globalThis["__dataset_api__"];
const result = f1(10, ["inc", "mul", "dec"]);
result.preview = f0(0, 10);
console.log(JSON.stringify(result));
