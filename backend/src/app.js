const bcrypt = require("bcryptjs");
const cors = require("cors");
const express = require("express");
const rateLimit = require("express-rate-limit");
const MongoStore = require("connect-mongo");
const session = require("express-session");
const helmet = require("helmet");
const mongoose = require("mongoose");
const { asyncHandler, createCsrfToken, requireAdmin, requireCsrf } = require("./auth");
const { createEmptyState } = require("./default-state");
const ClubState = require("./models/ClubState");
const { validateState } = require("./validate-state");

const SESSION_COOKIE_NAME = "carrisfc.sid";
const SESSION_MAX_AGE = 12 * 60 * 60 * 1000;

function createApp({
  frontendOrigins,
  mongodbUri,
  sessionSecret,
  adminEmail,
  adminPasswordHash,
  isProduction = false,
  sessionStore
}) {
  const app = express();
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: SESSION_MAX_AGE,
    path: "/"
  };
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({ error: "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo." });
    }
  });

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({
    credentials: true,
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
  app.use("/api", (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  app.use(session({
    name: SESSION_COOKIE_NAME,
    secret: sessionSecret,
    store: sessionStore || MongoStore.create({
      mongoUrl: mongodbUri,
      collectionName: "sessions",
      ttl: SESSION_MAX_AGE / 1000,
      autoRemove: "native"
    }),
    resave: false,
    saveUninitialized: false,
    cookie: cookieOptions
  }));

  app.get("/api/health", (_request, response) => {
    const connected = mongoose.connection.readyState === 1;
    response.status(connected ? 200 : 503).json({
      status: connected ? "ok" : "unavailable",
      database: connected ? "connected" : "disconnected"
    });
  });

  app.get("/api/auth/csrf", (request, response, next) => {
    if (!request.session.csrfToken) request.session.csrfToken = createCsrfToken();
    request.session.save(error => {
      if (error) return next(error);
      response.json({ csrfToken: request.session.csrfToken });
    });
  });

  app.get("/api/auth/session", (request, response) => {
    const authenticated = Boolean(request.session.adminEmail);
    response.json({
      authenticated,
      email: authenticated ? request.session.adminEmail : ""
    });
  });

  app.post("/api/auth/login", requireCsrf, loginLimiter, asyncHandler(async (request, response, next) => {
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const passwordMatches = await bcrypt.compare(password, adminPasswordHash);
    if (email !== adminEmail || !passwordMatches || Buffer.byteLength(password, "utf8") > 72) {
      response.status(401).json({ error: "Correo o contraseña incorrectos." });
      return;
    }

    request.session.regenerate(error => {
      if (error) return next(error);
      request.session.adminEmail = adminEmail;
      request.session.csrfToken = createCsrfToken();
      request.session.save(saveError => {
        if (saveError) return next(saveError);
        response.json({ authenticated: true, email: adminEmail, csrfToken: request.session.csrfToken });
      });
    });
  }));

  app.post("/api/auth/logout", requireCsrf, requireAdmin, (request, response, next) => {
    request.session.destroy(error => {
      if (error) return next(error);
      response.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        path: "/"
      });
      response.status(204).end();
    });
  });

  app.get("/api/state", asyncHandler(async (_request, response) => {
    const record = await ClubState.findOneAndUpdate(
      { key: "club" },
      { $setOnInsert: { state: createEmptyState() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    response.json(record.state);
  }));

  app.put("/api/state", requireCsrf, requireAdmin, asyncHandler(async (request, response) => {
    const state = validateState(request.body);
    const record = await ClubState.findOneAndUpdate(
      { key: "club" },
      { $set: { state } },
      { new: true, upsert: true, runValidators: true }
    ).lean();
    response.json({ state: record.state });
  }));

  app.use((_request, response) => {
    response.status(404).json({ error: "Ruta no encontrada." });
  });

  app.use((error, _request, response, _next) => {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
    if (status >= 500) console.error("Error en la API:", error.message);
    response.status(status).json({
      error: status === 403 ? "Origen o token de seguridad no permitido." :
        status === 400 ? "La solicitud no tiene un formato válido." :
          "Error interno del servidor."
    });
  });

  return app;
}

module.exports = { createApp };
