// One-off migration:
//  1. items.is_hidden — an admin "deletes" an item by hiding it: it disappears from every list,
//     but past reports keep showing it.
//  2. items.multi_unit / max_units — e.g. rings: the reporter says how many and describes each one;
//     every unit becomes its own report (linked as found together), so each is matched on its own.
//     Turned on for "טבעת", whose "כמות" question it replaces.
//  3. attribute_values.detail_kind / detail_prompt — picking that answer opens a follow-up field:
//     'text' (e.g. "שם" -> "מה השם?") or 'letters_or_text' ("only letters?" -> one box per letter).
//     Preset for names, the necklace pendant/name answers and the tefillin "שם או אותיות" answer.
// Run with --dry to only print what would change.
require("dotenv").config();
const pool = require("./pool");

const dry = process.argv.includes("--dry");

// [value text, detail_kind, prompt] — applied wherever that exact answer exists
const DETAIL_PRESETS = [
  ["שם", "text", "מה השם?"],
  ["השם על הכרטיס", "text", "מה השם שעל הכרטיס?"],
  ["שרשרת עם שם", "text", "מה השם?"],
  ["שרשרת עם תליון", "text", "תאר/י את התליון"],
  ["שם או אותיות על הנרתיק", "letters_or_text", "מה כתוב על הנרתיק?"],
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS multi_unit BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS max_units INTEGER NOT NULL DEFAULT 5`);
    await client.query(`ALTER TABLE attribute_values ADD COLUMN IF NOT EXISTS detail_kind TEXT`);
    await client.query(`ALTER TABLE attribute_values ADD COLUMN IF NOT EXISTS detail_prompt TEXT`);

    for (const [value, kind, prompt] of DETAIL_PRESETS) {
      const r = await client.query(
        `UPDATE attribute_values SET detail_kind = $2, detail_prompt = $3 WHERE value = $1 AND detail_kind IS NULL RETURNING id`,
        [value, kind, prompt]
      );
      console.log(`"${value}" -> ${kind} "${prompt}": ${r.rowCount} answers`);
    }

    const ring = await client.query(`UPDATE items SET multi_unit = true, max_units = 5 WHERE name = 'טבעת' RETURNING id`);
    console.log(`multi-unit items: ${ring.rowCount} (טבעת)`);
    if (ring.rowCount) {
      const ringId = ring.rows[0].id;
      const qty = await client.query(
        `DELETE FROM item_attributes ia USING attributes a
         WHERE ia.attribute_id = a.id AND ia.item_id = $1 AND a.name = 'כמות' RETURNING a.id`,
        [ringId]
      );
      // the item's own copy is deleted too unless past reports answered it
      for (const q of qty.rows) {
        await client.query(
          `DELETE FROM attributes a WHERE a.id = $1
             AND NOT EXISTS (SELECT 1 FROM item_attributes WHERE attribute_id = a.id)
             AND NOT EXISTS (SELECT 1 FROM report_attribute_values WHERE attribute_id = a.id)`,
          [q.id]
        );
      }
      console.log(`טבעת: "כמות" question removed (${qty.rowCount}), replaced by "how many rings"`);
    }

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
