const { Pool } = require("pg");
require("dotenv").config();

// Hosted Postgres (Neon, Render, etc.) requires SSL but usually with a cert chain `pg` won't
// validate automatically — sslmode=require in the URL alone isn't enough in every pg version.
const needsSSL = /sslmode=require|neon\.tech|render\.com/.test(process.env.DATABASE_URL || "");

module.exports = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSSL ? { rejectUnauthorized: false } : undefined,
});
