// One-off migration: the base question "אזור ארץ" is no longer asked (the city is enough). It's
// taken off the base questions only — the question and the regions past reports already gave stay
// in the database, so those reports keep showing them.
require("dotenv").config();
const pool = require("./pool");

async function run() {
  const r = await pool.query(
    `DELETE FROM universal_attributes WHERE attribute_id IN (SELECT id FROM attributes WHERE name = 'אזור ארץ') RETURNING attribute_id`
  );
  console.log(`"אזור ארץ" removed from base questions: ${r.rowCount}`);
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
