await import(process.env.DATASET_TARGET ?? "../manual/cart_total.js");
const [f0] = globalThis["__dataset_api__"];
const res1 = f0({
  items: [
    { price: 15, quantity: 2 },
    { price: 8.5, quantity: 3 },
  ],
}, "SAVE10");
const res2 = f0({ items: [{ price: 100, quantity: 1 }] }, "FLAT20");
console.log(JSON.stringify({ res1, res2 }));
