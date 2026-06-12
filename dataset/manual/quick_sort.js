/* @vm-obfuscate */
function f0(arr, low, high) {
  const pivot = arr[high];
  let i = low - 1;
  for (let j = low; j < high; j++) {
    if (arr[j] < pivot) {
      i++;
      const temp = arr[i];
      arr[i] = arr[j];
      arr[j] = temp;
    }
  }
  const temp = arr[i + 1];
  arr[i + 1] = arr[high];
  arr[high] = temp;
  return i + 1;
}

/* @vm-obfuscate */
function f1(arr, low, high) {
  if (low < high) {
    const pi = f0(arr, low, high);
    f1(arr, low, pi - 1);
    f1(arr, pi + 1, high);
  }
}

/* @vm-obfuscate */
function f2(arr) {
  const copy = arr.slice();
  f1(copy, 0, copy.length - 1);
  return copy;
}

globalThis["__dataset_api__"] = [f2];
