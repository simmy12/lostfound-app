const express = require("express");
const pool = require("../db/pool");

const router = express.Router();

// Full category tree: main -> sub -> items
router.get("/categories", async (req, res) => {
  const mains = await pool.query("SELECT id, name FROM categories_main ORDER BY name");
  const subs = await pool.query("SELECT id, main_id, name FROM categories_sub ORDER BY name");
  const tree = mains.rows.map((m) => ({
    ...m,
    subs: subs.rows.filter((s) => s.main_id === m.id).map((s) => ({ id: s.id, name: s.name })),
  }));
  res.json(tree);
});

router.get("/subs/:subId/items", async (req, res) => {
  const r = await pool.query("SELECT id, name FROM items WHERE sub_id = $1 ORDER BY name", [req.params.subId]);
  res.json(r.rows);
});

router.get("/items/:itemId", async (req, res) => {
  const r = await pool.query(
    "SELECT id, name, can_be_contained, can_have_nearby, can_contain_items FROM items WHERE id = $1",
    [req.params.itemId]
  );
  if (!r.rows.length) return res.status(404).json({ error: "not found" });
  res.json(r.rows[0]);
});

// attributes (+ their value options) that apply to a given item, in display order
router.get("/items/:itemId/attributes", async (req, res) => {
  const r = await pool.query(
    `SELECT a.id, a.name, a.input_type, ia.display_order, ia.weight
     FROM item_attributes ia JOIN attributes a ON a.id = ia.attribute_id
     WHERE ia.item_id = $1 ORDER BY ia.display_order`,
    [req.params.itemId]
  );
  const attrs = r.rows;
  const values = await pool.query(
    `SELECT attribute_id, id, value FROM attribute_values
     WHERE attribute_id = ANY($1::int[]) ORDER BY display_order`,
    [attrs.map((a) => a.id)]
  );
  res.json(
    attrs.map((a) => ({
      ...a,
      values: values.rows.filter((v) => v.attribute_id === a.id).map((v) => ({ id: v.id, value: v.value })),
    }))
  );
});

// universal attributes shown on every report (location/date step)
router.get("/universal-attributes", async (req, res) => {
  const r = await pool.query(
    `SELECT a.id, a.name, a.input_type, ua.display_order, ua.weight
     FROM universal_attributes ua JOIN attributes a ON a.id = ua.attribute_id
     ORDER BY ua.display_order`
  );
  const attrs = r.rows;
  const values = await pool.query(
    `SELECT attribute_id, id, value FROM attribute_values
     WHERE attribute_id = ANY($1::int[]) ORDER BY display_order`,
    [attrs.map((a) => a.id)]
  );
  res.json(
    attrs.map((a) => ({
      ...a,
      values: values.rows.filter((v) => v.attribute_id === a.id).map((v) => ({ id: v.id, value: v.value })),
    }))
  );
});

module.exports = router;
