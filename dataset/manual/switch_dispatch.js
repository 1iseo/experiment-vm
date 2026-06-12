/* @vm-obfuscate */
function f0(instructions) {
  let accumulator = 0;
  let state = "READY";

  for (let i = 0; i < instructions.length; i++) {
    const inst = instructions[i];

    switch (state) {
      case "READY":
        if (inst.type === "START") state = "ACTIVE";
        break;
      case "ACTIVE":
        switch (inst.op) {
          case "ADD":
            accumulator += inst.val;
            break;
          case "SUB":
            accumulator -= inst.val;
            break;
          case "MUL":
            accumulator *= inst.val;
            break;
          case "PAUSE":
            state = "PAUSED";
            break;
          case "STOP":
            state = "DONE";
            break;
        }
        break;
      case "PAUSED":
        if (inst.type === "RESUME") state = "ACTIVE";
        break;
      case "DONE":
        break;
    }

    if (state === "DONE") break;
  }

  return { accumulator, finalState: state };
}

globalThis["__dataset_api__"] = [f0];
