/* @vm-obfuscate */
function base64Encode(str) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  let i = 0;
  
  while (i < str.length) {
    const c1 = str.charCodeAt(i++) || 0;
    const c2 = str.charCodeAt(i++) || 0;
    const c3 = str.charCodeAt(i++) || 0;
    
    const byte1 = c1 >> 2;
    const byte2 = ((c1 & 3) << 4) | (c2 >> 4);
    const byte3 = isNaN(c2) ? 64 : (((c2 & 15) << 2) | (c3 >> 6));
    const byte4 = isNaN(c3) ? 64 : (c3 & 63);
    
    result += chars.charAt(byte1) + chars.charAt(byte2);
    result += byte3 === 64 ? "=" : chars.charAt(byte3);
    result += byte4 === 64 ? "=" : chars.charAt(byte4);
  }
  return result;
}

globalThis["__dataset_api__"] = [base64Encode];
