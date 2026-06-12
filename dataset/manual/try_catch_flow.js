/* @vm-obfuscate */
function parseAndCalculateJson(jsonStr) {
  let log = "";
  let result = null;
  try {
    log += "Enter outer try;";
    const data = JSON.parse(jsonStr);
    try {
      log += "Enter inner try;";
      if (typeof data.x !== "number" || typeof data.y !== "number") {
        throw new TypeError("x and y must be numbers");
      }
      if (data.y === 0) {
        throw new RangeError("Division by zero");
      }
      result = data.x / data.y;
      log += "Finish inner try;";
    } catch (e) {
      log += "Catch inner: " + e.name + ";";
      result = -1;
    } finally {
      log += "Finally inner;";
    }
    log += "Finish outer try;";
  } catch (e) {
    log += "Catch outer: " + e.name + ";";
    result = -2;
  } finally {
    log += "Finally outer;";
  }
  return { result, log };
}

globalThis["__dataset_api__"] = [parseAndCalculateJson];
