require("dotenv").config();

const mongoose = require("mongoose");
const { createApp } = require("./app");
const { loadConfig } = require("./config");
const { connectDatabase } = require("./database");

async function startServer() {
  const config = loadConfig();
  await connectDatabase(config.mongodbUri);

  const app = createApp(config);
  const server = app.listen(config.port, () => {
    console.log(`API de Carris FC escuchando en el puerto ${config.port}.`);
  });

  const shutdown = signal => {
    console.log(`Señal ${signal}: cerrando la API.`);
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

startServer().catch(error => {
  console.error("No se pudo iniciar el backend:", error.message);
  process.exitCode = 1;
});
