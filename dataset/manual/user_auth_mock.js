/* @vm-obfuscate */
function f0(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

/* @vm-obfuscate */
function f1(db, username, rawPassword) {
  if (!(username in db)) return false;
  const hashedInput = f0(rawPassword);
  return db[username].passwordHash === hashedInput;
}

/* @vm-obfuscate */
function f2(sessions, token) {
  if (!(token in sessions)) return null;
  const session = sessions[token];
  if (session.expiresAt < Date.now() / 1000) return null;
  return session.user;
}

globalThis["__dataset_api__"] = [f0, f1, f2];
