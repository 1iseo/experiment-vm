/* @vm-obfuscate */
function isPalindrome(str) {
  if (typeof str !== "string") return false;
  const cleaned = str.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const len = cleaned.length;
  for (let i = 0; i < len / 2; i++) {
    if (cleaned[i] !== cleaned[len - 1 - i]) return false;
  }
  return true;
}

/* @vm-obfuscate */
function isAnagram(str1, str2) {
  if (typeof str1 !== "string" || typeof str2 !== "string") return false;
  const clean1 = str1.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const clean2 = str2.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (clean1.length !== clean2.length) return false;
  
  const charCounts = {};
  for (let i = 0; i < clean1.length; i++) {
    const char = clean1[i];
    charCounts[char] = (charCounts[char] || 0) + 1;
  }
  
  for (let i = 0; i < clean2.length; i++) {
    const char = clean2[i];
    if (!charCounts[char]) return false;
    charCounts[char]--;
  }
  return true;
}

/* @vm-obfuscate */
function compressString(str) {
  if (!str) return "";
  let compressed = "";
  let count = 1;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === str[i + 1]) {
      count++;
    } else {
      compressed += str[i] + count;
      count = 1;
    }
  }
  return compressed.length < str.length ? compressed : str;
}

globalThis["__dataset_api__"] = [
  isPalindrome,
  isAnagram,
  compressString,
];
