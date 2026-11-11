const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const mongoose = require("mongoose");

function createApp({ frontendOrigins }) {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || frontendOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      const error = new Error("Origen no permitido.");
      error.status = 403;
      callback(error);
    }
  }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_request, response) => {
    const connected = mongoose.connection.readyState === 1;
    response.status(connected ? 200 : 503).json({
      status: connected ? "ok" : "unavailable",
      database: connected ? "connected" : "disconnected"
    });
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "Ruta no encontrada." });
  });

  app.use((error, _request, response, _next) => {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
    if (status >= 500) console.error("Error en la API:", error.message);
    response.status(status).json({
      error: status === 403 ? "Origen no permitido." :
        status === 400 ? "La solicitud no tiene un formato válido." :
          "Error interno del servidor."
    });
  });

  return app;
}

module.exports = { createApp };
