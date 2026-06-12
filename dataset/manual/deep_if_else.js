/* @vm-obfuscate */
function checkSystemAccess(user, resource, operation) {
  if (user) {
    if (user.role === "admin") {
      return true; // Admin has access to everything
    } else if (user.role === "manager") {
      if (resource.owner === user.id) {
        return true; // Manager owns it
      } else {
        if (resource.dept === user.dept) {
          if (operation === "READ" || operation === "WRITE") {
            return true; // Managers can read/write dept resources
          }
        }
      }
    } else if (user.role === "employee") {
      if (resource.dept === user.dept) {
        if (!resource.isConfidential) {
          if (operation === "READ") {
            return true; // Employees can read non-confidential dept resources
          }
        }
      }
    }
  }
  return false;
}

globalThis["__dataset_api__"] = [checkSystemAccess];
