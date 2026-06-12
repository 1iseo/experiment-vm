/* @vm-obfuscate */
function createTracker(initialValue) {
  let count = initialValue;
  
  return {
    increment: function() {
      count++;
      return count;
    },
    decrement: function() {
      count--;
      return count;
    },
    getValue: function() {
      return count;
    }
  };
}

globalThis["__dataset_api__"] = [createTracker];
