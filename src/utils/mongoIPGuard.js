// src/utils/mongoIPGuard.js

const mongoose = require("mongoose");
const { getPublicIP, addIPIfNeeded } = require("./ipUtils"); // ✅ Corrected path
const { log, error } = require("../services/logger");

let lastIP = null;

/**
 * If MongoDB rejects due to IP access issues, attempt to fix and re-whitelist current IP.
 */
async function refreshIPIfRejected(err) {
  // now catches TLS handshake alerts as well
  const ipError =
    err.message.includes("access is not allowed") ||
    err.message.includes("not authorized") ||
    err.message.includes("ECONNREFUSED") ||
    err.message.includes("MongoNetworkError") ||
    err.code === "EPROTO" ||
    err.message.toLowerCase().includes("ssl alert");

  if (!ipError) return false;

  try {
    const currentIP = await getPublicIP();
    if (currentIP !== lastIP) {
      log(`🔁 MongoDB rejection detected (${err.code || err.message}). Refreshing IP: ${currentIP}`);
      await addIPIfNeeded(currentIP);
      lastIP = currentIP;
      return true;
    }
  } catch (ipErr) {
    error("❌ Failed to refresh IP after MongoDB rejection:", ipErr);
  }

  return false;
}


/**
 * Applies automatic IP handling to MongoDB connection + query methods.
 */
function applyMongoIPGuard(originalConnect) {
  // Patch mongoose.connect()
  mongoose.connect = async function (...args) {
    try {
      return await originalConnect.apply(this, args);
    } catch (err) {
      const fixed = await refreshIPIfRejected(err);
      if (fixed) return originalConnect.apply(this, args); // Retry after IP fix
      throw err;
    }
  };

  // Patch mongoose queries (like .find, .save, etc.)
  const exec = mongoose.Query.prototype.exec;
  mongoose.Query.prototype.exec = async function (...args) {
    try {
      return await exec.apply(this, args);
    } catch (err) {
      const fixed = await refreshIPIfRejected(err);
      if (fixed) return exec.apply(this, args); // Retry after IP fix
      throw err;
    }
  };
}

module.exports = { applyMongoIPGuard };
