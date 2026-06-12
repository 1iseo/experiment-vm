await import(process.env.DATASET_TARGET ?? "../manual/date_utils.js");
const [f0, f1, f2] = globalThis["__dataset_api__"];
const date1 = f2("2024-02-29");
const days = date1 ? f1(date1.month, date1.year) : 0;
console.log(JSON.stringify({
  date1,
  days,
  leap2000: f0(2000),
  leap1900: f0(1900),
}));
