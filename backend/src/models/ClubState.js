const mongoose = require("mongoose");

const clubStateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  state: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.ClubState || mongoose.model("ClubState", clubStateSchema);
