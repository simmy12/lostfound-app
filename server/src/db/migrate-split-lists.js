// One-off migration: every item gets its own, independent copy of each question it asks (the admin
// decided "חברה" on one item has nothing to do with "חברה" on another). For each item-level
// question shared by several items, the lowest item id keeps the original; every other item gets a
// copy (same name/type/values/order/hidden flags), its item link is moved to the copy, and that
// item's past report answers are re-pointed to the copy's matching values. Set-based SQL, one
// transaction. Run with --dry to only print what would be split.
require("dotenv").config();
const pool = require("./pool");

const dry = process.argv.includes("--dry");

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `CREATE TEMP TABLE split_map ON COMMIT DROP AS
       SELECT ia.item_id, ia.attribute_id AS old_id,
              nextval(pg_get_serial_sequence('attributes', 'id'))::int AS new_id
       FROM item_attributes ia JOIN attributes a ON a.id = ia.attribute_id
       WHERE a.scope = 'item'
         AND ia.item_id <> (SELECT MIN(x.item_id) FROM item_attributes x WHERE x.attribute_id = ia.attribute_id)`
    );
    const summary = await client.query(
      `SELECT a.name, m.old_id, COUNT(*)::int AS copies FROM split_map m JOIN attributes a ON a.id = m.old_id
       GROUP BY a.name, m.old_id ORDER BY copies DESC`
    );
    for (const r of summary.rows) console.log(`#${r.old_id} ${r.name}: ${r.copies} new copies`);
    const total = summary.rows.reduce((n, r) => n + r.copies, 0);
    console.log(`${summary.rows.length} shared questions, ${total} copies`);

    await client.query(
      `INSERT INTO attributes (id, name, input_type, scope, created_at)
       SELECT m.new_id, a.name, a.input_type, a.scope, a.created_at FROM split_map m JOIN attributes a ON a.id = m.old_id`
    );
    await client.query(
      `INSERT INTO attribute_values (attribute_id, value, display_order, hidden)
       SELECT m.new_id, v.value, v.display_order, v.hidden FROM split_map m JOIN attribute_values v ON v.attribute_id = m.old_id`
    );
    const moved = await client.query(
      `UPDATE report_attribute_values rav
       SET attribute_id = m.new_id,
           value_id = (SELECT nv.id FROM attribute_values ov
                       JOIN attribute_values nv ON nv.attribute_id = m.new_id AND nv.value = ov.value
                       WHERE ov.id = rav.value_id)
       FROM reports r, split_map m
       WHERE rav.report_id = r.id AND r.item_id = m.item_id AND rav.attribute_id = m.old_id`
    );
    console.log(`${moved.rowCount} past answers re-pointed`);
    await client.query(
      `UPDATE item_attributes ia SET attribute_id = m.new_id
       FROM split_map m WHERE ia.item_id = m.item_id AND ia.attribute_id = m.old_id`
    );

    const still = await client.query(
      `SELECT COUNT(*)::int AS n FROM (SELECT attribute_id FROM item_attributes GROUP BY attribute_id HAVING COUNT(*) > 1) s`
    );
    console.log(`questions still shared after split: ${still.rows[0].n}`);
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
