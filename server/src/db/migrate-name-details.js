// One-off migration: every existing answer mentioning "עם שם" ("with a name") that has no
// follow-up yet asks "מה השם?" when picked — new ones get this automatically from the server.
require("dotenv").config();
const pool = require("./pool");

async function run() {
  const r = await pool.query(
    `UPDATE attribute_values SET detail_kind = 'text', detail_prompt = 'מה השם?'
     WHERE detail_kind IS NULL AND value LIKE '%עם שם%' RETURNING value`
  );
  console.log(`answers now asking for the name: ${r.rowCount}`, [...new Set(r.rows.map((x) => x.value))].join(", "));
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
