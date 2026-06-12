/* @vm-obfuscate */
function f0(board, row, col, n) {
  for (let i = 0; i < row; i++) {
    if (board[i] === col) return false;
  }
  for (let i = row, j = col; i >= 0 && j >= 0; i--, j--) {
    if (board[i] === j) return false;
  }
  for (let i = row, j = col; i >= 0 && j < n; i--, j++) {
    if (board[i] === j) return false;
  }
  return true;
}

/* @vm-obfuscate */
function f1(board, row, n, solutions) {
  if (row === n) {
    solutions.push(board.slice());
    return;
  }
  for (let col = 0; col < n; col++) {
    if (f0(board, row, col, n)) {
      board[row] = col;
      f1(board, row + 1, n, solutions);
      board[row] = -1;
    }
  }
}

/* @vm-obfuscate */
function f2(n) {
  const board = new Array(n).fill(-1);
  const solutions = [];
  f1(board, 0, n, solutions);
  return solutions;
}

globalThis["__dataset_api__"] = [f2];
