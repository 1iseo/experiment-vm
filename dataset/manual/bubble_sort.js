/* @vm-obfuscate */
function bubbleSort(arr) {
  const n = arr.length;
  const result = arr.slice();
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - i - 1; j++) {
      if (result[j] > result[j + 1]) {
        const temp = result[j];
        result[j] = result[j + 1];
        result[j + 1] = temp;
      }
    }
  }
  return result;
}

globalThis["__dataset_api__"] = [bubbleSort];
