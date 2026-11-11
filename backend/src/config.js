function loadConfig(environment = process.env) {
  const port = Number(environment.PORT || 10000);
  const mongodbUri = String(environment.MONGODB_URI || "").trim();
  const rawFrontendOrigins = String(environment.FRONTEND_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
  const frontendOrigins = rawFrontendOrigins.map(origin => {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new Error("Cada origen de FRONTEND_ORIGINS debe ser una URL válida.");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
      throw new Error("FRONTEND_ORIGINS debe contener solo el origen, sin rutas ni credenciales.");
    }
    return url.origin;
  });
  const adminEmail = String(environment.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPasswordHash = String(environment.ADMIN_PASSWORD_HASH || "").trim();
  const sessionSecret = String(environment.SESSION_SECRET || "");

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT debe ser un número entero entre 1 y 65535.");
  }
  if (!mongodbUri) {
    throw new Error("Falta MONGODB_URI. Configúrala en el entorno del backend.");
  }
  if (mongodbUri.includes("<") || mongodbUri.includes(">")) {
    throw new Error("MONGODB_URI todavía contiene marcadores de ejemplo.");
  }
  if (!mongodbUri.startsWith("mongodb://") && !mongodbUri.startsWith("mongodb+srv://")) {
    throw new Error("MONGODB_URI debe comenzar por mongodb:// o mongodb+srv://.");
  }
  if (frontendOrigins.length === 0 || frontendOrigins.includes("*")) {
    throw new Error("FRONTEND_ORIGINS debe contener los orígenes permitidos, sin usar *.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    throw new Error("ADMIN_EMAIL debe ser una dirección de correo válida.");
  }
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(adminPasswordHash)) {
    throw new Error("ADMIN_PASSWORD_HASH debe ser un hash bcrypt generado por el script del backend.");
  }
  if (Buffer.byteLength(sessionSecret, "utf8") < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 bytes aleatorios.");
  }

  return {
    port,
    mongodbUri,
    frontendOrigins,
    adminEmail,
    adminPasswordHash,
    sessionSecret,
    isProduction: environment.NODE_ENV === "production"
  };
}

module.exports = { loadConfig };
