// One-off migration (admin requests, Oct 2026):
//  1. items.container_order — admin-set order of the "בתוך מה היה?" list (starts alphabetical).
//  2. yes/no questions (exactly "כן"/"לא") are single choice with no "אחר" option.
//  3. every "כמות" question is single choice with no "אחר" option.
//  4. "שרשרת עם/בלי תליון" asks exactly the same questions as "צמיד": questions with the same name
//     are kept (same ids, so past answers still match) and synced — type, settings, answers and
//     their order; missing ones are copied from צמיד; extra ones are removed from the necklace.
// Run with --dry to only print what would change.
require("dotenv").config();
const pool = require("./pool");

const dry = process.argv.includes("--dry");
const SOURCE_ITEM = "צמיד";
const TARGET_ITEM = "שרשרת עם/בלי תליון";

async function syncItemQuestions(db) {
  const items = await db.query(`SELECT id, name FROM items WHERE name = ANY($1::text[])`, [[SOURCE_ITEM, TARGET_ITEM]]);
  const src = items.rows.find((i) => i.name === SOURCE_ITEM);
  const dst = items.rows.find((i) => i.name === TARGET_ITEM);
  if (!src || !dst) return console.log(`skip: "${SOURCE_ITEM}" or "${TARGET_ITEM}" not found`);

  const q = (itemId) =>
    db.query(
      `SELECT a.id, a.name, a.input_type, a.max_select, ia.display_order, ia.weight, ia.required, ia.allow_other
       FROM item_attributes ia JOIN attributes a ON a.id = ia.attribute_id WHERE ia.item_id = $1 ORDER BY ia.display_order`,
      [itemId]
    );
  const srcQs = (await q(src.id)).rows;
  const dstQs = (await q(dst.id)).rows;

  for (const [order, s] of srcQs.entries()) {
    let target = dstQs.find((d) => d.name === s.name);
    if (!target) {
      const r = await db.query(`INSERT INTO attributes (name, input_type, scope, max_select) VALUES ($1,$2,'item',$3) RETURNING id`, [s.name, s.input_type, s.max_select]);
      target = { id: r.rows[0].id, name: s.name };
      await db.query(`INSERT INTO item_attributes (item_id, attribute_id) VALUES ($1,$2)`, [dst.id, target.id]);
      console.log(`  + "${s.name}" copied to ${TARGET_ITEM}`);
    } else {
      console.log(`  = "${s.name}" kept (#${target.id}), synced`);
    }
    await db.query(`UPDATE attributes SET input_type = $1, max_select = $2 WHERE id = $3`, [s.input_type, s.max_select, target.id]);
    await db.query(
      `UPDATE item_attributes SET display_order = $1, weight = $2, required = $3, allow_other = $4 WHERE item_id = $5 AND attribute_id = $6`,
      [order, s.weight, s.required, s.allow_other, dst.id, target.id]
    );
    // answers: same list and order as the source; extras deleted, or hidden if a past report used them
    const vals = await db.query(`SELECT value FROM attribute_values WHERE attribute_id = $1 AND NOT hidden ORDER BY display_order`, [s.id]);
    const keep = vals.rows.map((v) => v.value);
    for (const [i, value] of keep.entries()) {
      await db.query(
        `INSERT INTO attribute_values (attribute_id, value, display_order) VALUES ($1,$2,$3)
         ON CONFLICT (attribute_id, value) DO UPDATE SET display_order = $3, hidden = false`,
        [target.id, value, i]
      );
    }
    await db.query(
      `UPDATE attribute_values v SET hidden = true WHERE attribute_id = $1 AND NOT (value = ANY($2::text[]))
         AND EXISTS (SELECT 1 FROM report_attribute_values r WHERE r.value_id = v.id)`,
      [target.id, keep]
    );
    await db.query(
      `DELETE FROM attribute_values v WHERE attribute_id = $1 AND NOT (value = ANY($2::text[]))
         AND NOT EXISTS (SELECT 1 FROM report_attribute_values r WHERE r.value_id = v.id)`,
      [target.id, keep]
    );
  }
  for (const d of dstQs.filter((d) => !srcQs.some((s) => s.name === d.name))) {
    await db.query(`DELETE FROM item_attributes WHERE item_id = $1 AND attribute_id = $2`, [dst.id, d.id]);
    console.log(`  - "${d.name}" removed from ${TARGET_ITEM}`);
  }
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS container_order INTEGER NOT NULL DEFAULT 0`);
    await client.query(
      `UPDATE items i SET container_order = o.n
       FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY name) AS n FROM items WHERE is_common_container) o
       WHERE i.id = o.id AND i.container_order = 0`
    );

    const yesNo = `SELECT a.id FROM attributes a
      WHERE (SELECT array_agg(v.value ORDER BY v.value) FROM attribute_values v WHERE v.attribute_id = a.id AND NOT v.hidden) = ARRAY['כן','לא']`;
    const yn = await client.query(`UPDATE attributes SET input_type = 'single' WHERE id IN (${yesNo}) RETURNING id`);
    await client.query(`UPDATE item_attributes SET allow_other = false WHERE attribute_id IN (${yesNo})`);
    await client.query(`UPDATE universal_attributes SET allow_other = false WHERE attribute_id IN (${yesNo})`);
    console.log(`${yn.rowCount} yes/no questions: single choice, no "אחר"`);

    const qty = await client.query(`UPDATE attributes SET input_type = 'single' WHERE name = 'כמות' AND input_type IN ('single','multi') RETURNING id`);
    await client.query(`UPDATE item_attributes SET allow_other = false WHERE attribute_id IN (SELECT id FROM attributes WHERE name = 'כמות')`);
    console.log(`${qty.rowCount} "כמות" questions: single choice, no "אחר"`);

    console.log(`${TARGET_ITEM} <- questions of ${SOURCE_ITEM}:`);
    await syncItemQuestions(client);

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
