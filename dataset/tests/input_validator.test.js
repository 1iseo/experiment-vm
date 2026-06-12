await import(process.env.DATASET_TARGET ?? "../manual/input_validator.js");
const [f0, f1, f2] = globalThis["__dataset_api__"];
console.log(JSON.stringify({
  email1: f0("test@example.com"),
  email2: f0("invalid-email"),
  phone1: f1("+6281234567890"),
  phone2: f1("123abc456"),
  pass1: f2("Weak1"),
  pass2: f2("StrongPassword123!"),
}));
