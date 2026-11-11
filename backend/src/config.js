function loadConfig(environment = process.env) {
  const port = Number(environment.PORT || 10000);
  const mongodbUri = String(environment.MONGODB_URI || "").trim();
  const frontendOrigins = String(environment.FRONTEND_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

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

  return { port, mongodbUri, frontendOrigins };
}

module.exports = { loadConfig };
