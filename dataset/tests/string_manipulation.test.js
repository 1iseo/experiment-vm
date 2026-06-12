await import(process.env.DATASET_TARGET ?? "../manual/string_manipulation.js");
const [f0, f1, f2] = globalThis["__dataset_api__"];
console.log(JSON.stringify({
  pal1: f0("A man, a plan, a canal: Panama"),
  pal2: f0("hello"),
  anagram1: f1("listen", "silent"),
  anagram2: f1("hello", "world"),
  comp1: f2("aabcccccaaa"),
  comp2: f2("abcd"),
}));
