await import(process.env.DATASET_TARGET ?? "../manual/deep_if_else.js");
const [f0] = globalThis["__dataset_api__"];
const admin = { role: "admin", id: "1", dept: "HR" };
const manager = { role: "manager", id: "2", dept: "ENG" };
const employee = { role: "employee", id: "3", dept: "ENG" };
const publicResource = { owner: "3", dept: "ENG", isConfidential: false };
const privateResource = { owner: "4", dept: "ENG", isConfidential: true };
console.log(JSON.stringify({
  adminOk: f0(admin, privateResource, "DELETE"),
  managerOk: f0(manager, publicResource, "WRITE"),
  employeeReadOk: f0(employee, publicResource, "READ"),
  employeeConfidentialFail: f0(employee, privateResource, "READ"),
}));
