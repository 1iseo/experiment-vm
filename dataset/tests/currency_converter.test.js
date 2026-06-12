await import(process.env.DATASET_TARGET ?? "../manual/currency_converter.js");
const [f0] = globalThis["__dataset_api__"];
console.log(JSON.stringify({
  usdToIdr: f0(100, "USD", "IDR"),
  eurToGbp: f0(50, "EUR", "GBP"),
  badExchange: f0(10, "XYZ", "USD"),
}));
