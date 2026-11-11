const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const { createApp } = require("../src/app");

function sessionCookie(response) {
  const header = response.headers.get("set-cookie");
  assert.ok(header, "expected the API to set a session cookie");
  return header.split(";")[0];
}

test("admin login requires CSRF and establishes a protected session", async t => {
  const adminEmail = "admin@example.com";
  const app = createApp({
    frontendOrigins: ["http://localhost:5500"],
    mongodbUri: "mongodb://127.0.0.1:27017/carrisfc-test",
    sessionSecret: "test-session-secret-with-more-than-32-bytes",
    adminEmail,
    adminPasswordHash: await bcrypt.hash("test-password", 4),
    sessionStore: new session.MemoryStore()
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Origin: "http://localhost:5500" }
  });
  assert.equal(csrfResponse.status, 200);
  assert.equal(csrfResponse.headers.get("access-control-allow-credentials"), "true");
  assert.match(csrfResponse.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(csrfResponse.headers.get("set-cookie"), /SameSite=Lax/i);
  const initialCookie = sessionCookie(csrfResponse);
  const { csrfToken } = await csrfResponse.json();

  const unauthenticatedWrite = await fetch(`${baseUrl}/api/state`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: initialCookie,
      "X-CSRF-Token": csrfToken
    },
    body: "{}"
  });
  assert.equal(unauthenticatedWrite.status, 401);

  const rejectedLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: initialCookie },
    body: JSON.stringify({ email: adminEmail, password: "test-password" })
  });
  assert.equal(rejectedLogin.status, 403);

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: initialCookie,
      "X-CSRF-Token": csrfToken,
      Origin: "http://localhost:5500"
    },
    body: JSON.stringify({ email: adminEmail, password: "test-password" })
  });
  assert.equal(loginResponse.status, 200);
  const authenticatedCookie = sessionCookie(loginResponse);
  const login = await loginResponse.json();
  assert.equal(login.authenticated, true);
  assert.equal(login.email, adminEmail);
  assert.notEqual(login.csrfToken, csrfToken);

  const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: authenticatedCookie }
  });
  assert.deepEqual(await sessionResponse.json(), { authenticated: true, email: adminEmail });

  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: {
      Cookie: authenticatedCookie,
      "X-CSRF-Token": login.csrfToken
    }
  });
  assert.equal(logoutResponse.status, 204);
  const loggedOut = await fetch(`${baseUrl}/api/auth/session`);
  assert.deepEqual(await loggedOut.json(), { authenticated: false, email: "" });
});
