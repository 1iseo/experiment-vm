/* @vm-obfuscate */
function validateEmail(email) {
  if (!email || typeof email !== "string") return false;
  const atIndex = email.indexOf("@");
  if (atIndex < 1) return false;
  const dotIndex = email.lastIndexOf(".");
  if (dotIndex <= atIndex + 1 || dotIndex === email.length - 1) return false;
  return true;
}

/* @vm-obfuscate */
function validatePhoneNumber(phone) {
  if (!phone || typeof phone !== "string") return false;
  // Needs to start with + or digits and be between 7 and 15 digits
  let start = 0;
  if (phone[0] === "+") {
    start = 1;
  }
  if (phone.length - start < 7 || phone.length - start > 15) return false;
  for (let i = start; i < phone.length; i++) {
    const charCode = phone.charCodeAt(i);
    if (charCode < 48 || charCode > 57) return false; // 0-9
  }
  return true;
}

/* @vm-obfuscate */
function validatePasswordStrength(password) {
  if (!password || password.length < 8) return 0;
  let score = 0;
  let hasUpper = false;
  let hasLower = false;
  let hasDigit = false;
  let hasSpecial = false;

  const specialChars = "!@#$%^&*()_+~`|}{[]:;?><,./-=";

  for (let i = 0; i < password.length; i++) {
    const char = password[i];
    if (char >= "A" && char <= "Z") hasUpper = true;
    else if (char >= "a" && char <= "z") hasLower = true;
    else if (char >= "0" && char <= "9") hasDigit = true;
    else if (specialChars.indexOf(char) !== -1) hasSpecial = true;
  }

  if (hasUpper) score++;
  if (hasLower) score++;
  if (hasDigit) score++;
  if (hasSpecial) score++;

  return score;
}

globalThis["__dataset_api__"] = [
  validateEmail,
  validatePhoneNumber,
  validatePasswordStrength,
];
