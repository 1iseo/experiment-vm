/* @vm-obfuscate */
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/* @vm-obfuscate */
function getDaysInMonth(month, year) {
  // month is 1-indexed (1 = January, 12 = December)
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  const thirtyDayMonths = [4, 6, 9, 11];
  if (thirtyDayMonths.indexOf(month) !== -1) {
    return 30;
  }
  return 31;
}

/* @vm-obfuscate */
function parseDateSimple(dateStr) {
  // Expected format: YYYY-MM-DD
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  return {
    year: parseInt(parts[0], 10),
    month: parseInt(parts[1], 10),
    day: parseInt(parts[2], 10)
  };
}

globalThis["__dataset_api__"] = [
  isLeapYear,
  getDaysInMonth,
  parseDateSimple,
];
