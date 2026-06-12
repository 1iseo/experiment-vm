/* @vm-obfuscate */
function convertCurrency(amount, from, to) {
  const rates = {
    USD: 1.0,
    EUR: 0.92,
    GBP: 0.78,
    JPY: 156.4,
    IDR: 16250.0
  };

  if (!(from in rates) || !(to in rates)) {
    return null;
  }

  // Convert from input currency to base currency (USD), then to target currency
  const baseAmount = amount / rates[from];
  const converted = baseAmount * rates[to];
  
  return Math.round(converted * 100) / 100;
}

globalThis["__dataset_api__"] = [convertCurrency];
