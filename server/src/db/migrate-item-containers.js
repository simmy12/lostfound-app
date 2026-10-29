// One-off migration: the "בתוך מה היה?" list becomes per item. item_containers holds, for each
// item, which items it can have been found inside and in what order. Every existing item starts
// with a copy of the current shared list (items.is_common_container, in container_order), so
// reporters see no change; items added later start with an empty list.
// Run with --dry to only print what would be created.
require("dotenv").config();
const pool = require("./pool");

const dry = process.argv.includes("--dry");

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `CREATE TABLE IF NOT EXISTS item_containers (
         item_id           INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
         container_item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
         display_order     INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (item_id, container_item_id)
       )`
    );
    const r = await client.query(
      `INSERT INTO item_containers (item_id, container_item_id, display_order)
       SELECT i.id, c.id, c.container_order
       FROM items i CROSS JOIN items c
       WHERE c.is_common_container AND NOT c.is_hidden AND c.id <> i.id
         AND NOT EXISTS (SELECT 1 FROM item_containers x WHERE x.item_id = i.id)
       ON CONFLICT DO NOTHING
       RETURNING item_id`
    );
    const items = new Set(r.rows.map((x) => x.item_id)).size;
    console.log(`${items} items got a copy of the shared list (${r.rowCount} rows)`);
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
