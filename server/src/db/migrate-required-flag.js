// One-off, non-destructive migration: adds a per-question "required" flag, defaulting to false
// everywhere (nothing is required until an admin explicitly marks it so).
require("dotenv").config();
const pool = require("./pool");

async function run() {
  await pool.query(`ALTER TABLE item_attributes ADD COLUMN IF NOT EXISTS required BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE universal_attributes ADD COLUMN IF NOT EXISTS required BOOLEAN NOT NULL DEFAULT false`);
  console.log("migration applied: item_attributes.required, universal_attributes.required");
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
