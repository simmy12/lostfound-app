// One-off migration:
//  1. attributes.max_select — how many answers a multiple-choice question allows (admin-set).
//  2. The question type now actually drives the wizard (it used to allow up to 2 picks on every
//     choice question regardless of type). To keep what reporters see unchanged, every choice
//     question except a plain yes/no becomes "multi" with max 2; the admin can change it from there.
//  3. "אחר..." stored as a regular answer duplicated the automatic "אחר" option (which the admin
//     controls per question with the "אפשר אחר" checkbox). Those values are removed — or hidden
//     when a past report picked one, so that report keeps its answer.
// Run with --dry to only print what would change.
require("dotenv").config();
const pool = require("./pool");

const dry = process.argv.includes("--dry");

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`ALTER TABLE attributes ADD COLUMN IF NOT EXISTS max_select INTEGER NOT NULL DEFAULT 2`);

    const toMulti = await client.query(
      `UPDATE attributes a SET input_type = 'multi', max_select = 2
       WHERE a.input_type = 'single'
         AND EXISTS (SELECT 1 FROM attribute_values v WHERE v.attribute_id = a.id AND NOT v.hidden)
         AND NOT (
           (SELECT COUNT(*) FROM attribute_values v WHERE v.attribute_id = a.id AND NOT v.hidden) = 2
           AND EXISTS (SELECT 1 FROM attribute_values v WHERE v.attribute_id = a.id AND NOT v.hidden AND v.value = 'כן')
           AND EXISTS (SELECT 1 FROM attribute_values v WHERE v.attribute_id = a.id AND NOT v.hidden AND v.value = 'לא')
         )
       RETURNING id`
    );
    console.log(`${toMulti.rowCount} choice questions set to multi (max 2), matching current behaviour`);

    const hidden = await client.query(
      `UPDATE attribute_values v SET hidden = true
       WHERE v.value LIKE 'אחר%' AND NOT v.hidden
         AND EXISTS (SELECT 1 FROM report_attribute_values r WHERE r.value_id = v.id)
       RETURNING id`
    );
    const deleted = await client.query(
      `DELETE FROM attribute_values v
       WHERE v.value LIKE 'אחר%'
         AND NOT EXISTS (SELECT 1 FROM report_attribute_values r WHERE r.value_id = v.id)
       RETURNING id`
    );
    console.log(`"אחר" answers: ${deleted.rowCount} deleted, ${hidden.rowCount} hidden (used by past reports)`);

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
