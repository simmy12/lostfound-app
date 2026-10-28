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

// "אחר" is never a regular answer — it's the automatic free-text option each question turns on
// or off with its "אפשר אחר" checkbox
const isOtherText = (v) => String(v).trim().startsWith("אחר");

async function createAttribute(db, { name, input_type, scope, values, max_select = 2 }) {
  const r = await db.query(
    `INSERT INTO attributes (name, input_type, scope, max_select) VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, input_type, scope, max_select]
  );
  const id = r.rows[0].id;
  const clean = values.filter((v) => !isOtherText(v));
  for (let i = 0; i < clean.length; i++) {
    await db.query(`INSERT INTO attribute_values (attribute_id, value, display_order) VALUES ($1,$2,$3)`, [id, clean[i], i]);
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

// a fresh, independent copy of an existing question: name, type, max picks and its visible
// answers in order, each with its follow-up ("מבקש פירוט") settings
async function copyAttribute(db, sourceId) {
  const a = await db.query(`SELECT name, input_type, max_select FROM attributes WHERE id = $1`, [sourceId]);
  if (!a.rows.length) return null;
  const id = await createAttribute(db, { ...a.rows[0], scope: "item", values: [] });
  await db.query(
    `INSERT INTO attribute_values (attribute_id, value, display_order, detail_kind, detail_prompt)
     SELECT $1, value, display_order, detail_kind, detail_prompt
     FROM attribute_values WHERE attribute_id = $2 AND NOT hidden`,
    [id, sourceId]
  );
  return id;
}

// copy a question onto an item together with its per-item settings (required, "אחר", weight)
// taken from fromItemId's link — or from any item asking it when fromItemId isn't given
async function copyQuestionToItem(db, sourceId, itemId, fromItemId) {
  const copyId = await copyAttribute(db, sourceId);
  if (!copyId) return;
  const link = await db.query(
    `SELECT required, allow_other, weight FROM item_attributes WHERE attribute_id = $1 ORDER BY (item_id = $2) DESC LIMIT 1`,
    [sourceId, fromItemId || 0]
  );
  await linkToItem(db, copyId, itemId);
  if (link.rows.length) {
    const { required, allow_other, weight } = link.rows[0];
    await db.query(
      `UPDATE item_attributes SET required = $1, allow_other = $2, weight = $3 WHERE item_id = $4 AND attribute_id = $5`,
      [required, allow_other, weight, itemId, copyId]
    );
  }
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
    for (const itemId of item_ids) await copyQuestionToItem(db, req.params.id, itemId);
  });
  res.json({ ok: true });
}));

// copy questions from another item onto this one, everything included (answers and their order,
// follow-ups, type, max picks, required, "אחר", weight) — all of them, or just attribute_ids
router.post("/admin/items/:id/copy-questions", asyncHandler(async (req, res) => {
  const { from_item_id, attribute_ids } = req.body;
  if (!from_item_id) return res.status(400).json({ error: "from_item_id is required" });
  const src = await pool.query(
    `SELECT attribute_id FROM item_attributes WHERE item_id = $1 ORDER BY display_order`,
    [from_item_id]
  );
  const ids = src.rows.map((r) => r.attribute_id).filter((id) => !attribute_ids || attribute_ids.includes(id));
  await inTransaction(async (db) => {
    for (const id of ids) await copyQuestionToItem(db, id, req.params.id, from_item_id);
  });
  res.json({ ok: true, count: ids.length });
}));

router.put("/admin/items/:id/question-order", asyncHandler(async (req, res) => {
  const { attribute_ids } = req.body;
  if (!Array.isArray(attribute_ids)) return res.status(400).json({ error: "attribute_ids is required" });
  await pool.query(
    `UPDATE item_attributes ia SET display_order = o.pos
     FROM unnest($1::int[]) WITH ORDINALITY AS o(id, pos)
     WHERE ia.attribute_id = o.id AND ia.item_id = $2`,
    [attribute_ids, req.params.id]
  );
  res.json({ ok: true });
}));

// create a brand-new question, either as a base question asked on every report, or for one or
// more items (item_id / item_ids) — each item getting its own independent copy
router.post("/admin/attributes", asyncHandler(async (req, res) => {
  const { name, input_type = "single", values = [], item_id, universal, max_select } = req.body;
  const itemIds = req.body.item_ids || (item_id ? [item_id] : []);
  if (!name) return res.status(400).json({ error: "name is required" });
  if (!itemIds.length && !universal) return res.status(400).json({ error: "item_id(s) or universal is required" });

  const id = await inTransaction(async (db) => {
    if (universal) {
      const attributeId = await createAttribute(db, { name, input_type, scope: "universal", values, max_select });
      await db.query(
        `INSERT INTO universal_attributes (attribute_id, display_order)
         VALUES ($1, (SELECT COALESCE(MAX(display_order)+1,0) FROM universal_attributes))`,
        [attributeId]
      );
      return attributeId;
    }
    let first = null;
    for (const itemId of itemIds) {
      const attributeId = await createAttribute(db, { name, input_type, scope: "item", values, max_select });
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
           FROM attribute_values WHERE attribute_id = $2 AND NOT hidden AND value NOT LIKE 'אחר%') src
     ON CONFLICT (attribute_id, value) DO UPDATE SET hidden = false WHERE attribute_values.hidden
     RETURNING id`,
    [req.params.attributeId, from_attribute_id]
  );
  res.json({ ok: true, count: r.rowCount });
}));

const INPUT_TYPES = ["single", "multi", "text", "number"];

router.put("/admin/attributes/:id/type", asyncHandler(async (req, res) => {
  const { input_type, max_select } = req.body;
  if (!INPUT_TYPES.includes(input_type)) return res.status(400).json({ error: "invalid input_type" });
  const max = Number(max_select);
  if (input_type === "multi" && !(Number.isInteger(max) && max >= 2)) {
    return res.status(400).json({ error: "max_select must be a whole number of at least 2" });
  }
  const r = await pool.query(
    `UPDATE attributes SET input_type = $1, max_select = COALESCE($2, max_select) WHERE id = $3 RETURNING id`,
    [input_type, input_type === "multi" ? max : null, req.params.id]
  );
  if (!r.rows.length) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
}));

// add a selectable value to an attribute
router.post("/admin/attributes/:attributeId/values", asyncHandler(async (req, res) => {
  const { value } = req.body;
  if (!value) return res.status(400).json({ error: "value is required" });
  if (isOtherText(value)) return res.status(400).json({ error: "\"אחר\" אינו תשובה רגילה — יש לסמן \"אפשר אחר\" בשאלה" });
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

// reword an answer in place — it keeps its id, so reports that already picked it still show it
// (with the new wording) and still match against new reports that pick it
router.put("/admin/attribute-values/:id", asyncHandler(async (req, res) => {
  const value = (req.body.value || "").trim();
  if (!value) return res.status(400).json({ error: "value is required" });
  if (isOtherText(value)) return res.status(400).json({ error: "\"אחר\" אינו תשובה רגילה" });
  try {
    const r = await pool.query(`UPDATE attribute_values SET value = $1 WHERE id = $2 RETURNING id`, [value, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: "not found" });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "תשובה בשם הזה כבר קיימת ברשימה" });
    throw e;
  }
  res.json({ ok: true });
}));

// an answer's follow-up: picking it opens a field — detail_kind 'text' or 'letters_or_text'
// (asks "only letters?" and then gives one box per letter), or null for none
router.put("/admin/attribute-values/:id/detail", asyncHandler(async (req, res) => {
  const kind = req.body.detail_kind || null;
  if (kind && !["text", "letters_or_text"].includes(kind)) return res.status(400).json({ error: "invalid detail_kind" });
  const prompt = kind ? (req.body.detail_prompt || "").trim() || null : null;
  await pool.query(`UPDATE attribute_values SET detail_kind = $1, detail_prompt = $2 WHERE id = $3`, [kind, prompt, req.params.id]);
  res.json({ ok: true });
}));

// remove several answers at once — same rule as one: hidden if past reports picked it, else deleted
router.post("/admin/attribute-values/delete", asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "ids is required" });
  await pool.query(
    `UPDATE attribute_values v SET hidden = true WHERE v.id = ANY($1::int[])
       AND EXISTS (SELECT 1 FROM report_attribute_values r WHERE r.value_id = v.id)`,
    [ids]
  );
  await pool.query(
    `DELETE FROM attribute_values v WHERE v.id = ANY($1::int[])
       AND NOT EXISTS (SELECT 1 FROM report_attribute_values r WHERE r.value_id = v.id)`,
    [ids]
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
    `SELECT i.id, i.name, i.sub_id, i.can_be_contained, i.can_have_nearby, i.can_contain_items, i.is_common_container,
            i.is_hidden, i.multi_unit, i.max_units,
            cs.name AS sub_name, cm.id AS main_id, cm.name AS main_name
     FROM items i JOIN categories_sub cs ON cs.id = i.sub_id JOIN categories_main cm ON cm.id = cs.main_id
     ORDER BY (cm.name = 'אחר'), cm.name, (cs.name = 'אחר'), cs.name, (i.name = 'אחר'), i.name`
  );
  res.json(r.rows);
}));

// one item's questions for the admin editor — like the public endpoint, plus allow_other
router.get("/admin/items/:itemId/attributes", asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT a.id, a.name, a.input_type, a.max_select, ia.display_order, ia.weight, ia.required, ia.allow_other
     FROM item_attributes ia JOIN attributes a ON a.id = ia.attribute_id
     WHERE ia.item_id = $1 ORDER BY ia.display_order`,
    [req.params.itemId]
  );
  const attrs = r.rows;
  const values = await pool.query(
    `SELECT attribute_id, id, value, detail_kind, detail_prompt FROM attribute_values
     WHERE attribute_id = ANY($1::int[]) AND NOT hidden ORDER BY (value LIKE 'אחר%'), display_order`,
    [attrs.map((a) => a.id)]
  );
  res.json(
    attrs.map((a) => ({
      ...a,
      values: values.rows.filter((v) => v.attribute_id === a.id).map((v) => ({ id: v.id, value: v.value, detail_kind: v.detail_kind, detail_prompt: v.detail_prompt })),
    }))
  );
}));

router.get("/admin/universal-attributes", asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT a.id, a.name, a.input_type, a.max_select, ua.weight, ua.display_order, ua.required, ua.allow_other
     FROM universal_attributes ua JOIN attributes a ON a.id = ua.attribute_id
     ORDER BY ua.display_order`
  );
  const attrs = r.rows;
  const values = await pool.query(
    `SELECT attribute_id, id, value, detail_kind, detail_prompt FROM attribute_values
     WHERE attribute_id = ANY($1::int[]) AND NOT hidden ORDER BY (value LIKE 'אחר%'), display_order`,
    [attrs.map((a) => a.id)]
  );
  res.json(
    attrs.map((a) => ({
      ...a,
      values: values.rows.filter((v) => v.attribute_id === a.id).map((v) => ({ id: v.id, value: v.value, detail_kind: v.detail_kind, detail_prompt: v.detail_prompt })),
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

router.put("/admin/items/:id/name", asyncHandler(async (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "name is required" });
  const r = await pool.query(`UPDATE items SET name = $1 WHERE id = $2 RETURNING id`, [name, req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
}));

// "delete" an item: hidden from every list (catalog, search, admin tree, containers list) but
// past reports keep pointing at it and showing its name. Restorable.
router.put("/admin/items/:id/hidden", asyncHandler(async (req, res) => {
  const r = await pool.query(`UPDATE items SET is_hidden = $1 WHERE id = $2 RETURNING id`, [!!req.body.hidden, req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
}));

// delete a sub-category. One that still has items needs move_to_sub_id: its items (hidden ones
// too) move there first, so nothing is lost; otherwise 409 with the item count.
router.post("/admin/categories/subs/:id/delete", asyncHandler(async (req, res) => {
  const { move_to_sub_id } = req.body;
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM items WHERE sub_id = $1`, [req.params.id])).rows[0].n;
  if (n && !move_to_sub_id) return res.status(409).json({ error: "sub-category has items", count: n });
  if (n && Number(move_to_sub_id) === Number(req.params.id)) return res.status(400).json({ error: "cannot move items into the deleted sub-category" });
  await inTransaction(async (db) => {
    if (n) await db.query(`UPDATE items SET sub_id = $1 WHERE sub_id = $2`, [move_to_sub_id, req.params.id]);
    await db.query(`DELETE FROM categories_sub WHERE id = $1`, [req.params.id]);
  });
  res.json({ ok: true, moved: n });
}));

// ---- the "בתוך מה היה?" list: the items a reporter can pick as "it was inside this" ----

router.get("/admin/containers", asyncHandler(async (req, res) => {
  const r = await pool.query(`SELECT id, name FROM items WHERE is_common_container AND NOT is_hidden ORDER BY container_order, name`);
  res.json(r.rows);
}));

router.put("/admin/containers/order", asyncHandler(async (req, res) => {
  const { item_ids } = req.body;
  if (!Array.isArray(item_ids)) return res.status(400).json({ error: "item_ids is required" });
  await pool.query(
    `UPDATE items i SET container_order = o.pos FROM unnest($1::int[]) WITH ORDINALITY AS o(id, pos) WHERE i.id = o.id`,
    [item_ids]
  );
  res.json({ ok: true });
}));

// per-item flags: whether to ask "was this inside something?" / "anything found nearby?"
router.put("/admin/items/:id/flags", asyncHandler(async (req, res) => {
  const { can_be_contained, can_have_nearby, can_contain_items, is_common_container, multi_unit } = req.body;
  const maxUnits = req.body.max_units == null ? null : Math.max(2, Math.min(20, Number(req.body.max_units) || 2));
  const r = await pool.query(
    `UPDATE items SET
       can_be_contained    = COALESCE($1, can_be_contained),
       can_have_nearby     = COALESCE($2, can_have_nearby),
       can_contain_items   = COALESCE($3, can_contain_items),
       -- newly added to the "בתוך מה היה?" list -> goes last
       container_order     = CASE WHEN $4 AND NOT is_common_container
                               THEN (SELECT COALESCE(MAX(container_order), 0) + 1 FROM items WHERE is_common_container)
                               ELSE container_order END,
       is_common_container = COALESCE($4, is_common_container),
       multi_unit          = COALESCE($6, multi_unit),
       max_units           = COALESCE($7, max_units)
     WHERE id = $5 RETURNING id, can_be_contained, can_have_nearby, can_contain_items, is_common_container, multi_unit, max_units`,
    [can_be_contained, can_have_nearby, can_contain_items, is_common_container, req.params.id, multi_unit, maxUnits]
  );
  if (!r.rows.length) return res.status(404).json({ error: "not found" });
  res.json(r.rows[0]);
}));

// ---- "אחר" review: free-text answers reporters typed instead of picking a listed value ----

// grouped by attribute + normalized text, so repeated phrasings stand out
router.get("/admin/other-answers", asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT rav.attribute_id, a.name AS attribute_name, a.scope,
            (SELECT string_agg(i.name, ', ') FROM item_attributes ia JOIN items i ON i.id = ia.item_id
             WHERE ia.attribute_id = rav.attribute_id) AS item_name,
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
  if (isOtherText(text)) return res.status(400).json({ error: "\"אחר\" אינו תשובה רגילה" });

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
