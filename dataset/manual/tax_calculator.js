/* @vm-obfuscate */
function calculateProgressiveTax(income) {
  if (income <= 0) return 0;
  
  const brackets = [
    { limit: 60000000, rate: 0.05 },
    { limit: 250000000, rate: 0.15 },
    { limit: 500000000, rate: 0.25 },
    { limit: 5000000000, rate: 0.30 },
    { limit: Infinity, rate: 0.35 }
  ];

  let remainingIncome = income;
  let totalTax = 0;
  let previousLimit = 0;

  for (let i = 0; i < brackets.length; i++) {
    const bracket = brackets[i];
    const width = bracket.limit - previousLimit;
    if (remainingIncome <= width) {
      totalTax += remainingIncome * bracket.rate;
      break;
    } else {
      totalTax += width * bracket.rate;
      remainingIncome -= width;
      previousLimit = bracket.limit;
    }
  }

  return totalTax;
}

globalThis["__dataset_api__"] = [calculateProgressiveTax];
