// One-off migration (admin request):
//  1. items.units_prompt — the multi-unit question's wording, written by the admin per item
//     (e.g. "כמה טבעות נמצאו יחד?"). No default: the question isn't shown until it's filled in.
//  2. Every item's "בתוך מה היה?" list is emptied — the admin fills each one in herself.
// Run with --dry to only print what would change.
require("dotenv").config();
const pool = require("./pool");

const dry = process.argv.includes("--dry");

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS units_prompt TEXT`);
    const r = await client.query(`DELETE FROM item_containers RETURNING item_id`);
    console.log(`"בתוך מה היה?" lists emptied: ${new Set(r.rows.map((x) => x.item_id)).size} items (${r.rowCount} rows)`);
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
