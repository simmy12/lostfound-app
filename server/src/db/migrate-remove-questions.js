// One-off migration: removes questions the admin no longer wants anywhere —
//  - every item's "חדש" (new/used) question
//  - the base question "טסט1 היה?" (a test question that ended up on every report)
// Deleting a question cascades to its answer list and to any answers past reports gave it.
// Run with --dry to only print what would be deleted.
require("dotenv").config();
const pool = require("./pool");

const NAMES = ["חדש", "טסט1 היה?"];
const dry = process.argv.includes("--dry");

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT a.name, COUNT(DISTINCT a.id)::int AS questions,
              COUNT(DISTINCT ia.item_id)::int AS items,
              (SELECT COUNT(*)::int FROM report_attribute_values r JOIN attributes x ON x.id = r.attribute_id WHERE x.name = a.name) AS answers
       FROM attributes a LEFT JOIN item_attributes ia ON ia.attribute_id = a.id
       WHERE a.name = ANY($1::text[]) GROUP BY a.name`,
      [NAMES]
    );
    for (const r of found.rows) console.log(`"${r.name}": ${r.questions} questions, on ${r.items} items, ${r.answers} past answers`);
    const del = await client.query(`DELETE FROM attributes WHERE name = ANY($1::text[]) RETURNING id`, [NAMES]);
    console.log(`${del.rowCount} questions deleted`);
    await client.query(dry ? "ROLLBACK" : "COMMIT");
    console.log(dry ? "dry run, nothing changed" : "migration applied");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
