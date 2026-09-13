// One-off, non-destructive migration: adds items.is_common_container and seeds the curated list
// of "things something could be found inside" offered in the "בתוך מה היה?" flow.
require("dotenv").config();
const pool = require("./pool");

const CURATED_CONTAINERS = [
  "מזוודה",
  "תיק צד",
  "תיק גב/ילקוט",
  "ארנק",
  "נרתיק כרטיסים",
  "נרתיק מצלמה",
  "מעיל",
  "ז'קט",
  "עגלת תינוק",
  "שקית עם מגוון פריטים",
];

async function run() {
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS is_common_container BOOLEAN NOT NULL DEFAULT false`);
  const r = await pool.query(
    `UPDATE items SET is_common_container = true WHERE name = ANY($1::text[]) RETURNING name`,
    [CURATED_CONTAINERS]
  );
  console.log("migration applied: items.is_common_container");
  console.log(`marked ${r.rowCount} items:`, r.rows.map((x) => x.name).join(", "));
  const missing = CURATED_CONTAINERS.filter((n) => !r.rows.some((x) => x.name === n));
  if (missing.length) console.log("NOT FOUND in catalog:", missing.join(", "));
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
