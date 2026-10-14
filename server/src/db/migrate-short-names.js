// One-off, non-destructive migration: question names no longer need to be unique (matching and
// answers are keyed by attribute id, not name), then shortens "צבע <item>" -> "צבע" and
// "תיאור <item>" -> "תיאור". Each question keeps its own id and its own value list.
// Run with --dry to only list what would be renamed.
require("dotenv").config();
const pool = require("./pool");

const PREFIXES = ["צבע", "תיאור"];
const dry = process.argv.includes("--dry");

async function run() {
  const r = await pool.query(
    `SELECT id, name FROM attributes
     WHERE ${PREFIXES.map((_, i) => `name LIKE $${i + 1}`).join(" OR ")}
     ORDER BY name`,
    PREFIXES.map((p) => `${p} %`)
  );
  for (const row of r.rows) {
    const short = PREFIXES.find((p) => row.name.startsWith(`${p} `));
    console.log(`#${row.id}: ${row.name} -> ${short}`);
  }
  console.log(`${r.rows.length} questions${dry ? " (dry run, nothing changed)" : ""}`);
  if (dry) return pool.end();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`ALTER TABLE attributes DROP CONSTRAINT IF EXISTS attributes_name_key`);
    for (const p of PREFIXES) {
      await client.query(`UPDATE attributes SET name = $1 WHERE name LIKE $2`, [p, `${p} %`]);
    }
    await client.query("COMMIT");
    console.log("migration applied");
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
