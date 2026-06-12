/* @vm-obfuscate */
function binarySearchIterative(arr, target) {
  let left = 0;
  let right = arr.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (arr[mid] === target) {
      return mid;
    }
    if (arr[mid] < target) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return -1;
}

/* @vm-obfuscate */
function binarySearchRecursive(arr, target, left, right) {
  if (left > right) return -1;
  const mid = Math.floor((left + right) / 2);
  if (arr[mid] === target) return mid;
  if (arr[mid] > target) {
    return binarySearchRecursive(arr, target, left, mid - 1);
  }
  return binarySearchRecursive(arr, target, mid + 1, right);
}

globalThis["__dataset_api__"] = [
  binarySearchIterative,
  binarySearchRecursive,
];
