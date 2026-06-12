await import(process.env.DATASET_TARGET ?? "../manual/user_auth_mock.js");
const [f0, f1, f2] = globalThis["__dataset_api__"];
const users = {
  alice: { passwordHash: f0("supersecret") },
  bob: { passwordHash: f0("qwerty") },
};
const sessions = {
  "token-123": {
    user: "alice",
    expiresAt: Math.floor(Date.now() / 1000) + 1000,
  },
  "token-456": {
    user: "bob",
    expiresAt: Math.floor(Date.now() / 1000) - 1000,
  },
};
console.log(JSON.stringify({
  loginAliceOk: f1(users, "alice", "supersecret"),
  loginAliceFail: f1(users, "alice", "wrongpass"),
  sessionAlice: f2(sessions, "token-123"),
  sessionBob: f2(sessions, "token-456"),
}));
