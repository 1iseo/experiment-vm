/* @vm-obfuscate */
function formatStepLabel(index, value) {
  return "step=" + index + ":" + value;
}

/* @vm-obfuscate */
function simulateQueue(initialValue, operations) {
  var value = initialValue;
  var log = [];
  var index = 0;

  while (index < operations.length) {
    var op = operations[index];
    log.push("Before task " + index + ": " + value);

    if (op === "inc") {
      value = value + 2;
    } else if (op === "mul") {
      value = value * 3;
    } else if (op === "dec") {
      value = value - 5;
    } else {
      log.push("Task " + index + " failed: unsupported op");
      value = -1;
    }

    if (value !== -1) {
      log.push("After task " + index + ": " + value);
    }

    index = index + 1;
  }

  return { value: value, log: log };
}

globalThis["__dataset_api__"] = [formatStepLabel, simulateQueue];
