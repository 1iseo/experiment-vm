await import(process.env.DATASET_TARGET ?? "../manual/base64_codec.js");
const [f0] = globalThis["__dataset_api__"];
const raw = "Hello World!";
console.log(JSON.stringify({ raw, encoded: f0(raw) }));
