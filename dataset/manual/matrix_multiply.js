/* @vm-obfuscate */
function multiplyMatrices(a, b) {
  const aRows = a.length;
  const aCols = a[0].length;
  const bRows = b.length;
  const bCols = b[0].length;

  if (aCols !== bRows) {
    return null;
  }

  const result = new Array(aRows);
  for (let r = 0; r < aRows; ++r) {
    result[r] = new Array(bCols).fill(0);
    for (let c = 0; c < bCols; ++c) {
      for (let i = 0; i < aCols; ++i) {
        result[r][c] += a[r][i] * b[i][c];
      }
    }
  }

  return result;
}

globalThis["__dataset_api__"] = [multiplyMatrices];
