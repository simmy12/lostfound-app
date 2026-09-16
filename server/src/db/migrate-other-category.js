// One-off migration:
//  - renames the "שונות" catch-all category/sub/item to "אחר" everywhere
//  - merges the "אחר" main category's sub-categories into one flat sub, so picking main "אחר"
//    goes straight to its items (no sub-category step)
//  - marks the single generic "אחר" item as the free-text "I couldn't find my item" placeholder
//  - adds reports.other_item_text, for the mandatory free text typed when that placeholder is picked
require("dotenv").config();
const pool = require("./pool");

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`UPDATE categories_main SET name = 'אחר' WHERE name = 'שונות'`);
    await client.query(`UPDATE categories_sub SET name = 'אחר' WHERE name = 'שונות'`);
    await client.query(`UPDATE items SET name = 'אחר' WHERE name = 'שונות'`);

    const mainR = await client.query(`SELECT id FROM categories_main WHERE name = 'אחר'`);
    if (mainR.rows.length) {
      const mainId = mainR.rows[0].id;
      const subR = await client.query(
        `SELECT id FROM categories_sub WHERE main_id = $1 AND name = 'אחר'`,
        [mainId]
      );
      const otherSubId = subR.rows[0].id;
      const extraSubs = await client.query(
        `SELECT id FROM categories_sub WHERE main_id = $1 AND id <> $2`,
        [mainId, otherSubId]
      );
      for (const s of extraSubs.rows) {
        await client.query(`UPDATE items SET sub_id = $1 WHERE sub_id = $2`, [otherSubId, s.id]);
        await client.query(`DELETE FROM categories_sub WHERE id = $1`, [s.id]);
      }

      await client.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS is_other_placeholder BOOLEAN NOT NULL DEFAULT false`);
      await client.query(
        `UPDATE items SET is_other_placeholder = true WHERE sub_id = $1 AND name = 'אחר'`,
        [otherSubId]
      );
    }

    await client.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS other_item_text TEXT`);

    await client.query("COMMIT");
    console.log("migration applied: שונות -> אחר rename, sub-category merge, items.is_other_placeholder, reports.other_item_text");
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
