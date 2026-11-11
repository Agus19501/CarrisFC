const mongoose = require("mongoose");

async function connectDatabase(mongodbUri) {
  await mongoose.connect(mongodbUri, { serverSelectionTimeoutMS: 10000 });
  console.log("Conexión con MongoDB establecida.");
}

module.exports = { connectDatabase };
