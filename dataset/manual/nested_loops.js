/* @vm-obfuscate */
function findPatternMatch(grid, pattern) {
  const R = grid.length;
  const C = grid[0].length;
  const PR = pattern.length;
  const PC = pattern[0].length;
  const matches = [];

  for (let r = 0; r <= R - PR; r++) {
    for (let c = 0; c <= C - PC; c++) {
      let isMatch = true;
      for (let pr = 0; pr < PR; pr++) {
        for (let pc = 0; pc < PC; pc++) {
          if (grid[r + pr][c + pc] !== pattern[pr][pc]) {
            isMatch = false;
            break;
          }
        }
        if (!isMatch) break;
      }
      if (isMatch) {
        matches.push({ row: r, col: c });
      }
    }
  }
  return matches;
}

globalThis["__dataset_api__"] = [findPatternMatch];
