const { randomBytes, timingSafeEqual } = require("node:crypto");

function createCsrfToken() {
  return randomBytes(32).toString("base64url");
}

function hasValidCsrfToken(expected, provided) {
  if (typeof expected !== "string" || typeof provided !== "string") return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer);
}

function requireCsrf(request, response, next) {
  const expected = request.session && request.session.csrfToken;
  const provided = request.get("x-csrf-token");
  if (!hasValidCsrfToken(expected, provided)) {
    response.status(403).json({ error: "La sesión de seguridad ha caducado. Recarga la página." });
    return;
  }
  next();
}

function requireAdmin(request, response, next) {
  if (!request.session || !request.session.adminEmail) {
    response.status(401).json({ error: "Inicia sesión como administrador para continuar." });
    return;
  }
  next();
}

function asyncHandler(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

module.exports = { asyncHandler, createCsrfToken, hasValidCsrfToken, requireAdmin, requireCsrf };
