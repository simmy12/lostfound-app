require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("./pool");

async function run() {
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await client.query(sql);
    console.log("schema applied");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
