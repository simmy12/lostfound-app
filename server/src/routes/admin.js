const express = require("express");
const pool = require("../db/pool");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

// update weight / required / allow_other ("אחר" offered) of an item-specific attribute
router.put("/admin/item-attributes/:itemId/:attributeId", asyncHandler(async (req, res) => {
  const { weight, required, allow_other } = req.body;
  await pool.query(
    `UPDATE item_attributes SET
       weight      = COALESCE($1, weight),
       required    = COALESCE($2, required),
       allow_other = COALESCE($3, allow_other)
     WHERE item_id = $4 AND attribute_id = $5`,
    [weight, required, allow_other, req.params.itemId, req.params.attributeId]
  );
  res.json({ ok: true });
}));

// update weight / required / allow_other of a universal attribute
router.put("/admin/universal-attributes/:attributeId", asyncHandler(async (req, res) => {
  const { weight, required, allow_other } = req.body;
  await pool.query(
    `UPDATE universal_attributes SET
       weight      = COALESCE($1, weight),
       required    = COALESCE($2, required),
       allow_other = COALESCE($3, allow_other)
     WHERE attribute_id = $4`,
    [weight, required, allow_other, req.params.attributeId]
  );
  res.json({ ok: true });
}));

// rename a question's wording — shared by every item/universal report that asks it
router.put("/admin/attributes/:id/name", asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
  const r = await pool.query(`UPDATE attributes SET name = $1 WHERE id = $2 RETURNING id`, [name.trim(), req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
}));

// Every item has its own, independent copy of each question it asks — editing "חברה" on one item
// never touches "חברה" on another. These helpers create/copy a question and attach it to one item.

async function createAttribute(db, { name, input_type, scope, values }) {
  const r = await db.query(`INSERT INTO attributes (name, input_type, scope) VALUES ($1, $2, $3) RETURNING id`, [name, input_type, scope]);
  const id = r.rows[0].id;
  for (let i = 0; i < values.length; i++) {
    await db.query(`INSERT INTO attribute_values (attribute_id, value, display_order) VALUES ($1,$2,$3)`, [id, values[i], i]);
  }
  return id;
}

// attach a question to an item, appended after the item's existing questions
async function linkToItem(db, attributeId, itemId) {
  await db.query(
    `INSERT INTO item_attributes (item_id, attribute_id, display_order)
     VALUES ($1, $2, (SELECT COALESCE(MAX(display_order)+1,0) FROM item_attributes WHERE item_id = $1))`,
    [itemId, attributeId]
  );
}

// a fresh copy of an existing question (name, type, visible values in their order)
async function copyAttribute(db, sourceId) {
  const a = await db.query(`SELECT name, input_type FROM attributes WHERE id = $1`, [sourceId]);
  if (!a.rows.length) return null;
  const v = await db.query(
    `SELECT value FROM attribute_values WHERE attribute_id = $1 AND NOT hidden ORDER BY display_order`,
    [sourceId]
  );
  return createAttribute(db, { ...a.rows[0], scope: "item", values: v.rows.map((r) => r.value) });
}

// runs fn inside a transaction on a dedicated client
async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// every question (item and base) with the item asking it — feeds "copy an existing question" and
// "copy answers from another list"
router.get("/admin/attributes", asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT a.id, a.name, a.input_type, a.scope,
            COALESCE(array_agg(i.name ORDER BY i.name) FILTER (WHERE i.id IS NOT NULL), '{}') AS item_names
     FROM attributes a
     LEFT JOIN item_attributes ia ON ia.attribute_id = a.id
     LEFT JOIN items i ON i.id = ia.item_id
     LEFT JOIN universal_attributes ua ON ua.attribute_id = a.id
     WHERE ia.item_id IS NOT NULL OR ua.attribute_id IS NOT NULL
     GROUP BY a.id ORDER BY a.scope DESC, a.name, MIN(i.name)`
  );
  res.json(r.rows);
}));

// give one or more items their own copy of an existing question (with its answer list)
router.post("/admin/attributes/:id/items", asyncHandler(async (req, res) => {
  const { item_ids } = req.body;
  if (!Array.isArray(item_ids) || !item_ids.length) return res.status(400).json({ error: "item_ids is required" });
  await inTransaction(async (db) => {
    for (const itemId of item_ids) {
      const copyId = await copyAttribute(db, req.params.id);
      if (copyId) await linkToItem(db, copyId, itemId);
    }
  });
  res.json({ ok: true });
}));

// create a brand-new question, either as a base question asked on every report, or for one or
// more items (item_id / item_ids) — each item getting its own independent copy
router.post("/admin/attributes", asyncHandler(async (req, res) => {
  const { name, input_type = "single", values = [], item_id, universal } = req.body;
  const itemIds = req.body.item_ids || (item_id ? [item_id] : []);
  if (!name) return res.status(400).json({ error: "name is required" });
  if (!itemIds.length && !universal) return res.status(400).json({ error: "item_id(s) or universal is required" });

  const id = await inTransaction(async (db) => {
    if (universal) {
      const attributeId = await createAttribute(db, { name, input_type, scope: "universal", values });
      await db.query(
        `INSERT INTO universal_attributes (attribute_id, display_order)
         VALUES ($1, (SELECT COALESCE(MAX(display_order)+1,0) FROM universal_attributes))`,
        [attributeId]
      );
      return attributeId;
    }
    let first = null;
    for (const itemId of itemIds) {
      const attributeId = await createAttribute(db, { name, input_type, scope: "item", values });
      await linkToItem(db, attributeId, itemId);
      first ??= attributeId;
    }
    return first;
  });
  res.status(201).json({ id });
}));

// remove a question from an item. Since every item has its own copy, the question itself is then
// deleted too — unless past reports answered it, in which case it's kept so those answers survive.
router.delete("/admin/items/:itemId/attributes/:attributeId", asyncHandler(async (req, res) => {
  const { itemId, attributeId } = req.params;
  await pool.query(`DELETE FROM item_attributes WHERE item_id = $1 AND attribute_id = $2`, [itemId, attributeId]);
  await pool.query(
    `DELETE FROM attributes a WHERE a.id = $1 AND a.scope = 'item'
       AND NOT EXISTS (SELECT 1 FROM item_attributes WHERE attribute_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM report_attribute_values WHERE attribute_id = a.id)`,
    [attributeId]
  );
  res.json({ ok: true });
}));

// delete a base question entirely — cascades to its values and every past answer recorded for it.
// Destructive; the client confirms with the admin before calling this.
router.delete("/admin/attributes/:id", asyncHandler(async (req, res) => {
  await pool.query(`DELETE FROM attributes WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));

// copy another list's answers into this one (appended in the source's order; answers already in
// this list are skipped, hidden ones are brought back)
router.post("/admin/attributes/:attributeId/values/copy", asyncHandler(async (req, res) => {
  const { from_attribute_id } = req.body;
  if (!from_attribute_id) return res.status(400).json({ error: "from_attribute_id is required" });
  const r = await pool.query(
    `INSERT INTO attribute_values (attribute_id, value, display_order)
     SELECT $1, src.value,
            (SELECT COALESCE(MAX(display_order), -1) FROM attribute_values WHERE attribute_id = $1) + src.n
     FROM (SELECT value, ROW_NUMBER() OVER (ORDER BY display_order) AS n
           FROM attribute_values WHERE attribute_id = $2 AND NOT hidden) src
     ON CONFLICT (attribute_id, value) DO UPDATE SET hidden = false WHERE attribute_values.hidden
     RETURNING id`,
    [req.params.attributeId, from_attribute_id]
  );
  res.json({ ok: true, count: r.rowCount });
}));

// add a selectable value to an attribute
router.post("/admin/attributes/:attributeId/values", asyncHandler(async (req, res) => {
  const { value } = req.body;
  if (!value) return res.status(400).json({ error: "value is required" });
  const r = await pool.query(
    `INSERT INTO attribute_values (attribute_id, value, display_order)
     VALUES ($1, $2, (SELECT COALESCE(MAX(display_order)+1,0) FROM attribute_values WHERE attribute_id = $1))
     ON CONFLICT (attribute_id, value) DO UPDATE SET hidden = false RETURNING id`,
    [req.params.attributeId, value]
  );
  res.status(201).json(r.rows[0] || {});
}));

// set the display order of an attribute's values (admin drags the answer tags) — value_ids in the
// new order; values not listed (e.g. hidden ones) keep their old position number
router.put("/admin/attributes/:attributeId/values/order", asyncHandler(async (req, res) => {
  const { value_ids } = req.body;
  if (!Array.isArray(value_ids)) return res.status(400).json({ error: "value_ids is required" });
  await pool.query(
    `UPDATE attribute_values v SET display_order = o.pos
     FROM unnest($1::int[]) WITH ORDINALITY AS o(id, pos)
     WHERE v.id = o.id AND v.attribute_id = $2`,
    [value_ids, req.params.attributeId]
  );
  res.json({ ok: true });
}));

// a value already picked in past reports can't be deleted (those answers point at it), so it's
// hidden from new reports instead; an unused value is deleted outright
router.delete("/admin/attribute-values/:id", asyncHandler(async (req, res) => {
  const used = await pool.query(`SELECT 1 FROM report_attribute_values WHERE value_id = $1 LIMIT 1`, [req.params.id]);
  if (used.rows.length) {
    await pool.query(`UPDATE attribute_values SET hidden = true WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true, hidden: true });
  }
  await pool.query(`DELETE FROM attribute_values WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));

// list every item together with its attribute/weight config — feeds the admin tree screen
router.get("/admin/items", asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT i.id, i.name, i.sub_id, i.can_be_contained, i.can_have_nearby, i.can_contain_items,
            cs.name AS sub_name, cm.id AS main_id, cm.name AS main_name
     FROM items i JOIN categories_sub cs ON cs.id = i.sub_id JOIN categories_main cm ON cm.id = cs.main_id
     ORDER BY (cm.name = 'אחר'), cm.name, (cs.name = 'אחר'), cs.name, (i.name = 'אחר'), i.name`
  );
  res.json(r.rows);
}));

// one item's questions for the admin editor — like the public endpoint, plus allow_other
router.get("/admin/items/:itemId/attributes", asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT a.id, a.name, a.input_type, ia.display_order, ia.weight, ia.required, ia.allow_other
     FROM item_attributes ia JOIN attributes a ON a.id = ia.attribute_id
     WHERE ia.item_id = $1 ORDER BY ia.display_order`,
    [req.params.itemId]
  );
  const attrs = r.rows;
  const values = await pool.query(
    `SELECT attribute_id, id, value FROM attribute_values
     WHERE attribute_id = ANY($1::int[]) AND NOT hidden ORDER BY (value LIKE 'אחר%'), display_order`,
    [attrs.map((a) => a.id)]
  );
  res.json(
    attrs.map((a) => ({
      ...a,
      values: values.rows.filter((v) => v.attribute_id === a.id).map((v) => ({ id: v.id, value: v.value })),
    }))
  );
}));

router.get("/admin/universal-attributes", asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT a.id, a.name, a.input_type, ua.weight, ua.display_order, ua.required, ua.allow_other
     FROM universal_attributes ua JOIN attributes a ON a.id = ua.attribute_id
     ORDER BY ua.display_order`
  );
  const attrs = r.rows;
  const values = await pool.query(
    `SELECT attribute_id, id, value FROM attribute_values
     WHERE attribute_id = ANY($1::int[]) AND NOT hidden ORDER BY (value LIKE 'אחר%'), display_order`,
    [attrs.map((a) => a.id)]
  );
  res.json(
    attrs.map((a) => ({
      ...a,
      values: values.rows.filter((v) => v.attribute_id === a.id).map((v) => ({ id: v.id, value: v.value })),
    }))
  );
}));

// ---- category management ----

router.get("/admin/categories", asyncHandler(async (req, res) => {
  const mains = await pool.query(`SELECT id, name FROM categories_main ORDER BY (name = 'אחר'), name`);
  const subs = await pool.query(`SELECT id, main_id, name FROM categories_sub ORDER BY (name = 'אחר'), name`);
  res.json(mains.rows.map((m) => ({ ...m, subs: subs.rows.filter((s) => s.main_id === m.id) })));
}));

// move an item to a different (existing) sub-category
router.put("/admin/items/:id/category", asyncHandler(async (req, res) => {
  const { sub_id } = req.body;
  if (!sub_id) return res.status(400).json({ error: "sub_id is required" });
  const r = await pool.query(`UPDATE items SET sub_id = $1 WHERE id = $2 RETURNING id`, [sub_id, req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
}));

// add a new sub-category under an existing main category
router.post("/admin/categories/:mainId/subs", asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const r = await pool.query(
    `INSERT INTO categories_sub (main_id, name) VALUES ($1,$2)
     ON CONFLICT (main_id, name) DO NOTHING RETURNING id`,
    [req.params.mainId, name]
  );
  res.status(201).json(r.rows[0] || {});
}));

// add a brand-new item directly to the catalog, without waiting for a citizen's "אחר" report
router.post("/admin/items", asyncHandler(async (req, res) => {
  const { sub_id, name, can_be_contained = true, can_have_nearby = true, can_contain_items = false } = req.body;
  if (!sub_id || !name) return res.status(400).json({ error: "sub_id and name are required" });
  const idR = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM items`);
  const newItemId = idR.rows[0].id;
  await pool.query(
    `INSERT INTO items (id, sub_id, name, can_be_contained, can_have_nearby, can_contain_items)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [newItemId, sub_id, name, can_be_contained, can_have_nearby, can_contain_items]
  );
  res.status(201).json({ id: newItemId });
}));

// per-item flags: whether to ask "was this inside something?" / "anything found nearby?"
router.put("/admin/items/:id/flags", asyncHandler(async (req, res) => {
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
}));

// ---- "אחר" review: free-text answers reporters typed instead of picking a listed value ----

// grouped by attribute + normalized text, so repeated phrasings stand out
router.get("/admin/other-answers", asyncHandler(async (req, res) => {
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
  const attrIds = [...new Set(r.rows.map((row) => row.attribute_id))];
  const values = await pool.query(
    `SELECT attribute_id, id, value FROM attribute_values WHERE attribute_id = ANY($1::int[]) ORDER BY (value LIKE 'אחר%'), display_order`,
    [attrIds]
  );
  res.json(
    r.rows.map((row) => ({
      ...row,
      values: values.rows.filter((v) => v.attribute_id === row.attribute_id).map((v) => ({ id: v.id, value: v.value })),
    }))
  );
}));

// promote a grouped "אחר" text to a real, selectable attribute value
router.post("/admin/other-answers/promote", asyncHandler(async (req, res) => {
  const { attribute_id, text, retroactive } = req.body;
  if (!attribute_id || !text) return res.status(400).json({ error: "attribute_id and text are required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let r = await client.query(
      `INSERT INTO attribute_values (attribute_id, value, display_order)
       VALUES ($1, $2, (SELECT COALESCE(MAX(display_order)+1,0) FROM attribute_values WHERE attribute_id = $1))
       ON CONFLICT (attribute_id, value) DO UPDATE SET hidden = false RETURNING id`,
      [attribute_id, text]
    );
    const valueId = r.rows[0].id;

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
}));

// reject a grouped "אחר" text — instead of adding it as a new value, re-point every report that
// used it to an existing, already-listed value for the same attribute
router.post("/admin/other-answers/reassign", asyncHandler(async (req, res) => {
  const { attribute_id, text, value_id } = req.body;
  if (!attribute_id || !text || !value_id) {
    return res.status(400).json({ error: "attribute_id, text and value_id are required" });
  }
  const owns = await pool.query(`SELECT 1 FROM attribute_values WHERE id = $1 AND attribute_id = $2`, [value_id, attribute_id]);
  if (!owns.rows.length) return res.status(400).json({ error: "value_id does not belong to attribute_id" });

  const upd = await pool.query(
    `UPDATE report_attribute_values SET value_id = $1, free_text = NULL
     WHERE attribute_id = $2 AND value_id IS NULL AND trim(free_text) = $3
     RETURNING id`,
    [value_id, attribute_id, text]
  );
  res.json({ updated: upd.rowCount });
}));

// ---- "אחר" item review: reports where the reporter couldn't find their item at all and typed
// free text instead (items.is_other_placeholder). An admin either reassigns the report to an
// existing item, or approves it by creating a new catalog item (in the category they pick) and
// reassigning the report to it — either way the report leaves this list once its item_id changes.

router.get("/admin/other-items", asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT r.id AS report_id, r.type, r.other_item_text, r.created_at
     FROM reports r
     JOIN items i ON i.id = r.item_id
     WHERE i.is_other_placeholder = true
       AND r.other_item_text IS NOT NULL AND trim(r.other_item_text) <> ''
     ORDER BY r.created_at`
  );
  res.json(r.rows);
}));

// reassign the report to an existing catalog item
router.post("/admin/other-items/:reportId/reassign", asyncHandler(async (req, res) => {
  const { item_id } = req.body;
  if (!item_id) return res.status(400).json({ error: "item_id is required" });
  const r = await pool.query(`UPDATE reports SET item_id = $1 WHERE id = $2 RETURNING id`, [item_id, req.params.reportId]);
  if (!r.rows.length) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
}));

// approve: create a new catalog item in the chosen sub-category from the reporter's free text,
// then reassign the report to it
router.post("/admin/other-items/:reportId/approve", asyncHandler(async (req, res) => {
  const { sub_id, name } = req.body;
  if (!sub_id || !name) return res.status(400).json({ error: "sub_id and name are required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const idR = await client.query(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM items`);
    const newItemId = idR.rows[0].id;
    await client.query(
      `INSERT INTO items (id, sub_id, name, can_be_contained, can_have_nearby, can_contain_items)
       VALUES ($1,$2,$3,true,true,false)`,
      [newItemId, sub_id, name]
    );
    const r = await client.query(`UPDATE reports SET item_id = $1 WHERE id = $2 RETURNING id`, [newItemId, req.params.reportId]);
    if (!r.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not found" });
    }
    await client.query("COMMIT");
    res.status(201).json({ item_id: newItemId });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "failed to approve item" });
  } finally {
    client.release();
  }
}));

module.exports = router;
