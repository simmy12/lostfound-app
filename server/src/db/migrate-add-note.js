// One-off, non-destructive migration: adds reports.note if it doesn't already exist.
require("dotenv").config();
const pool = require("./pool");

async function run() {
  await pool.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS note TEXT`);
  console.log("migration applied: reports.note");
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
