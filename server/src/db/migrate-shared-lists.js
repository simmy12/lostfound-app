// One-off, non-destructive migration:
//  1. attribute_values.hidden — a value already used by past reports can't be deleted (FK), so the
//     admin's ✕ hides it from new reports instead.
//  2. item_attributes.allow_other / universal_attributes.allow_other — per item+question toggle for
//     the automatic "אחר" option (default on, as before).
//  3. merges duplicate question lists into one shared list: the general "צבע" absorbs the
//     מגבעת / שטריימל / פלאפון-נגן colour lists (jewelry and wig colours stay separate), and the
//     three "חברה" lists become one. Past answers are re-pointed to the merged list's values.
// Run with --dry to only print what would be merged.
require("dotenv").config();
const pool = require("./pool");

// target attribute id <- source attribute ids; each id is checked against its expected name first
const MERGES = [
  { name: "צבע", target: 1, sources: [9, 12, 21] },
  { name: "חברה", target: 4, sources: [51, 52] },
];
const dry = process.argv.includes("--dry");

async function merge(client, { name, target, sources }) {
  const found = await client.query(`SELECT id FROM attributes WHERE name = $1 AND id = ANY($2::int[])`, [
    name,
    [target, ...sources],
  ]);
  const ids = new Set(found.rows.map((r) => r.id));
  if (!ids.has(target)) throw new Error(`target #${target} "${name}" not found`);
  const present = sources.filter((s) => ids.has(s));
  console.log(`"${name}": #${target} <- ${present.map((s) => "#" + s).join(", ") || "(nothing to merge)"}`);
  if (dry) return;

  for (const src of present) {
    const vals = await client.query(`SELECT id, value FROM attribute_values WHERE attribute_id = $1 ORDER BY display_order`, [src]);
    for (const v of vals.rows) {
      const r = await client.query(
        `INSERT INTO attribute_values (attribute_id, value, display_order)
         VALUES ($1, $2, (SELECT COALESCE(MAX(display_order)+1,0) FROM attribute_values WHERE attribute_id = $1))
         ON CONFLICT (attribute_id, value) DO UPDATE SET hidden = false RETURNING id`,
        [target, v.value]
      );
      await client.query(
        `UPDATE report_attribute_values SET attribute_id = $1, value_id = $2 WHERE attribute_id = $3 AND value_id = $4`,
        [target, r.rows[0].id, src, v.id]
      );
    }
    // free-text ("אחר") answers have no value to remap
    await client.query(`UPDATE report_attribute_values SET attribute_id = $1 WHERE attribute_id = $2`, [target, src]);
    // items that already ask the target question just drop the duplicate
    await client.query(
      `DELETE FROM item_attributes ia WHERE attribute_id = $2
         AND EXISTS (SELECT 1 FROM item_attributes x WHERE x.item_id = ia.item_id AND x.attribute_id = $1)`,
      [target, src]
    );
    await client.query(`UPDATE item_attributes SET attribute_id = $1 WHERE attribute_id = $2`, [target, src]);
    await client.query(`DELETE FROM attributes WHERE id = $1`, [src]);
  }
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`ALTER TABLE attribute_values ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE item_attributes ADD COLUMN IF NOT EXISTS allow_other BOOLEAN NOT NULL DEFAULT true`);
    await client.query(`ALTER TABLE universal_attributes ADD COLUMN IF NOT EXISTS allow_other BOOLEAN NOT NULL DEFAULT true`);
    for (const m of MERGES) await merge(client, m);
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
