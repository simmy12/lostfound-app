// One-off, non-destructive migration: optional second contact phone on reports.
require("dotenv").config();
const pool = require("./pool");

async function run() {
  await pool.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS contact_phone2 TEXT`);
  console.log("migration applied: reports.contact_phone2");
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
