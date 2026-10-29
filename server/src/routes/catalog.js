const express = require("express");
const pool = require("../db/pool");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

function parseId(req, res, name = "id") {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: `${name} must be an integer` });
    return null;
  }
  return id;
}

// Full category tree: main -> sub -> items
// "אחר" always sorts last, regardless of where it'd otherwise fall alphabetically
router.get("/categories", asyncHandler(async (req, res) => {
  const mains = await pool.query("SELECT id, name FROM categories_main ORDER BY (name = 'אחר'), name");
  const subs = await pool.query("SELECT id, main_id, name FROM categories_sub ORDER BY (name = 'אחר'), name");
  const tree = mains.rows.map((m) => ({
    ...m,
    subs: subs.rows.filter((s) => s.main_id === m.id).map((s) => ({ id: s.id, name: s.name })),
  }));
  res.json(tree);
}));

router.get("/subs/:subId/items", asyncHandler(async (req, res) => {
  const subId = parseId(req, res, "subId");
  if (subId == null) return;
  const r = await pool.query("SELECT id, name FROM items WHERE sub_id = $1 AND NOT is_hidden ORDER BY (name = 'אחר'), name", [subId]);
  res.json(r.rows);
}));

// free-text search across the whole item catalog (not scoped to a category) — powers the
// "חיפוש חופשי" alternative to the category/sub/item pickers.
router.get("/items/search", asyncHandler(async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);
  const r = await pool.query(
    `SELECT i.id, i.name, cs.name AS sub_name, cm.name AS main_name
     FROM items i JOIN categories_sub cs ON cs.id = i.sub_id JOIN categories_main cm ON cm.id = cs.main_id
     WHERE i.name ILIKE $1 AND NOT i.is_hidden
     ORDER BY (i.name = 'אחר'), i.name
     LIMIT 20`,
    [`%${q}%`]
  );
  res.json(r.rows);
}));

// the "בתוך מה היה?" options for one item — its own list, set by the admin per item (hidden
// items left out). Empty when the admin hasn't set one; the wizard then falls back to search.
router.get("/items/:itemId/containers", asyncHandler(async (req, res) => {
  const itemId = parseId(req, res, "itemId");
  if (itemId == null) return;
  const r = await pool.query(
    `SELECT i.id, i.name FROM item_containers ic JOIN items i ON i.id = ic.container_item_id
     WHERE ic.item_id = $1 AND NOT i.is_hidden ORDER BY ic.display_order, i.name`,
    [itemId]
  );
  res.json(r.rows);
}));

router.get("/items/:itemId", asyncHandler(async (req, res) => {
  const itemId = parseId(req, res, "itemId");
  if (itemId == null) return;
  const r = await pool.query(
    "SELECT id, name, can_be_contained, can_have_nearby, can_contain_items, is_other_placeholder, multi_unit, max_units FROM items WHERE id = $1",
    [itemId]
  );
  if (!r.rows.length) return res.status(404).json({ error: "not found" });
  res.json(r.rows[0]);
}));

// attributes (+ their value options) that apply to a given item, in display order
router.get("/items/:itemId/attributes", asyncHandler(async (req, res) => {
  const itemId = parseId(req, res, "itemId");
  if (itemId == null) return;
  const r = await pool.query(
    `SELECT a.id, a.name, a.input_type, a.max_select, ia.display_order, ia.weight, ia.required, ia.allow_other
     FROM item_attributes ia JOIN attributes a ON a.id = ia.attribute_id
     WHERE ia.item_id = $1 ORDER BY ia.display_order`,
    [itemId]
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

// universal attributes shown on every report (location/date step)
router.get("/universal-attributes", asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT a.id, a.name, a.input_type, a.max_select, ua.display_order, ua.weight, ua.required, ua.allow_other
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

module.exports = router;
