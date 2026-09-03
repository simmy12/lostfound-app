const express = require("express");
const pool = require("../db/pool");

const router = express.Router();

// update weight of an item-specific attribute
router.put("/admin/item-attributes/:itemId/:attributeId", async (req, res) => {
  const { weight } = req.body;
  await pool.query(
    `UPDATE item_attributes SET weight = $1 WHERE item_id = $2 AND attribute_id = $3`,
    [weight, req.params.itemId, req.params.attributeId]
  );
  res.json({ ok: true });
});

// update weight of a universal attribute
router.put("/admin/universal-attributes/:attributeId", async (req, res) => {
  const { weight } = req.body;
  await pool.query(`UPDATE universal_attributes SET weight = $1 WHERE attribute_id = $2`, [weight, req.params.attributeId]);
  res.json({ ok: true });
});

// add a selectable value to an attribute
router.post("/admin/attributes/:attributeId/values", async (req, res) => {
  const { value } = req.body;
  if (!value) return res.status(400).json({ error: "value is required" });
  const r = await pool.query(
    `INSERT INTO attribute_values (attribute_id, value, display_order)
     VALUES ($1, $2, (SELECT COALESCE(MAX(display_order)+1,0) FROM attribute_values WHERE attribute_id = $1))
     ON CONFLICT (attribute_id, value) DO NOTHING RETURNING id`,
    [req.params.attributeId, value]
  );
  res.status(201).json(r.rows[0] || {});
});

router.delete("/admin/attribute-values/:id", async (req, res) => {
  await pool.query(`DELETE FROM attribute_values WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// list every item together with its attribute/weight config — feeds the admin tree screen
router.get("/admin/items", async (req, res) => {
  const r = await pool.query(
    `SELECT i.id, i.name, i.sub_id, i.can_be_contained, i.can_have_nearby, i.can_contain_items,
            cs.name AS sub_name, cm.id AS main_id, cm.name AS main_name
     FROM items i JOIN categories_sub cs ON cs.id = i.sub_id JOIN categories_main cm ON cm.id = cs.main_id
     ORDER BY cm.name, cs.name, i.name`
  );
  res.json(r.rows);
});

router.get("/admin/universal-attributes", async (req, res) => {
  const r = await pool.query(
    `SELECT a.id, a.name, a.input_type, ua.weight, ua.display_order
     FROM universal_attributes ua JOIN attributes a ON a.id = ua.attribute_id
     ORDER BY ua.display_order`
  );
  res.json(r.rows);
});

// ---- category management ----

router.get("/admin/categories", async (req, res) => {
  const mains = await pool.query(`SELECT id, name FROM categories_main ORDER BY name`);
  const subs = await pool.query(`SELECT id, main_id, name FROM categories_sub ORDER BY name`);
  res.json(mains.rows.map((m) => ({ ...m, subs: subs.rows.filter((s) => s.main_id === m.id) })));
});

// move an item to a different (existing) sub-category
router.put("/admin/items/:id/category", async (req, res) => {
  const { sub_id } = req.body;
  if (!sub_id) return res.status(400).json({ error: "sub_id is required" });
  const r = await pool.query(`UPDATE items SET sub_id = $1 WHERE id = $2 RETURNING id`, [sub_id, req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

// add a new sub-category under an existing main category
router.post("/admin/categories/:mainId/subs", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const r = await pool.query(
    `INSERT INTO categories_sub (main_id, name) VALUES ($1,$2)
     ON CONFLICT (main_id, name) DO NOTHING RETURNING id`,
    [req.params.mainId, name]
  );
  res.status(201).json(r.rows[0] || {});
});

// per-item flags: whether to ask "was this inside something?" / "anything found nearby?"
router.put("/admin/items/:id/flags", async (req, res) => {
  const { can_be_contained, can_have_nearby, can_contain_items } = req.body;
  const r = await pool.query(
    `UPDATE items SET
       can_be_contained  = COALESCE($1, can_be_contained),
       can_have_nearby   = COALESCE($2, can_have_nearby),
       can_contain_items = COALESCE($3, can_contain_items)
     WHERE id = $4 RETURNING id, can_be_contained, can_have_nearby, can_contain_items`,
    [can_be_contained, can_have_nearby, can_contain_items, req.params.id]
  );
  if (!r.rows.length) return res.status(404).json({ error: "not found" });
  res.json(r.rows[0]);
});

// ---- "אחר" review: free-text answers reporters typed instead of picking a listed value ----

// grouped by attribute + normalized text, so repeated phrasings stand out
router.get("/admin/other-answers", async (req, res) => {
  const r = await pool.query(
    `SELECT rav.attribute_id, a.name AS attribute_name, a.scope,
            trim(rav.free_text) AS text, COUNT(*) AS count,
            MAX(rav.id) AS sample_id
     FROM report_attribute_values rav
     JOIN attributes a ON a.id = rav.attribute_id
     WHERE rav.value_id IS NULL AND rav.free_text IS NOT NULL AND trim(rav.free_text) <> ''
       AND a.input_type IN ('single','multi')
     GROUP BY rav.attribute_id, a.name, a.scope, trim(rav.free_text)
     ORDER BY count DESC, attribute_name`
  );
  res.json(r.rows);
});

// promote a grouped "אחר" text to a real, selectable attribute value
router.post("/admin/other-answers/promote", async (req, res) => {
  const { attribute_id, text, retroactive } = req.body;
  if (!attribute_id || !text) return res.status(400).json({ error: "attribute_id and text are required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let r = await client.query(
      `INSERT INTO attribute_values (attribute_id, value, display_order)
       VALUES ($1, $2, (SELECT COALESCE(MAX(display_order)+1,0) FROM attribute_values WHERE attribute_id = $1))
       ON CONFLICT (attribute_id, value) DO NOTHING RETURNING id`,
      [attribute_id, text]
    );
    let valueId = r.rows[0]?.id;
    if (!valueId) {
      const existing = await client.query(
        `SELECT id FROM attribute_values WHERE attribute_id = $1 AND value = $2`,
        [attribute_id, text]
      );
      valueId = existing.rows[0].id;
    }

    let updated = 0;
    if (retroactive) {
      const upd = await client.query(
        `UPDATE report_attribute_values SET value_id = $1, free_text = NULL
         WHERE attribute_id = $2 AND value_id IS NULL AND trim(free_text) = $3
         RETURNING id`,
        [valueId, attribute_id, text]
      );
      updated = upd.rowCount;
    }

    await client.query("COMMIT");
    res.status(201).json({ value_id: valueId, retroactively_updated: updated });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "failed to promote value" });
  } finally {
    client.release();
  }
});

module.exports = router;
