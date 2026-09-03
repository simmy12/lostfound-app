require("dotenv").config();
const pool = require("./pool");
const { buildCatalog } = require("./build-catalog");
const { universal } = require("./seed-attributes");

// Neither of these is loaded as a regular item_attribute — both are now control-flow questions
// driven by per-item boolean flags instead of sheet-assigned attributes:
//   "הפריט בתוך משהו" -> items.can_be_contained  ("was this inside something?")
//   "יש משהו בתוכו"   -> items.can_contain_items ("what was inside it?", opens the up-to-4 sub-flow)
// "תכולה" (a leftover simple list/empty question) is dropped entirely — superseded by the same
// up-to-4-contents flow.
const EXCLUDED_ATTRS = new Set(["הפריט בתוך משהו", "יש משהו בתוכו", "תכולה"]);
const CONTAINS_ITEMS_ATTR = "יש משהו בתוכו"; // used below to seed can_contain_items for the items
                                              // the sheet had already flagged, beyond the bags category
const BAGS_MAIN_CATEGORY = "מזוודות, תיקים, ארנקים, נרתיקים";

function weightFor(attrName) {
  if (attrName.includes("צבע")) return 15;
  if (attrName.includes("חברה")) return 12;
  if (attrName === "מידה" || attrName === "גודל" || attrName.includes("מידה")) return 10;
  if (attrName === "למי מתאים") return 8;
  return 7;
}

async function run() {
  const { tree, attrDefs, items, unmatched, treeOnlyCount } = buildCatalog();
  console.log(
    `catalog: ${items.length} items (${items.length - treeOnlyCount} with questions, ${treeOnlyCount} tree-only), ` +
      `${attrDefs.size} attributes, ${unmatched.length} unmatched -> שונות`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`TRUNCATE report_container_links, report_nearby_links, item_attributes,
      universal_attributes, attribute_values, report_attribute_values, matches, reports,
      items, attributes, categories_sub, categories_main RESTART IDENTITY CASCADE`);

    // --- categories + items ---
    const mainIds = new Map();
    const subIds = new Map();
    for (const item of items) {
      if (!mainIds.has(item.main)) {
        const r = await client.query(`INSERT INTO categories_main (name) VALUES ($1) RETURNING id`, [item.main]);
        mainIds.set(item.main, r.rows[0].id);
      }
      const mainId = mainIds.get(item.main);
      const subKey = item.main + "||" + item.sub;
      if (!subIds.has(subKey)) {
        const r = await client.query(
          `INSERT INTO categories_sub (main_id, name) VALUES ($1,$2) RETURNING id`,
          [mainId, item.sub]
        );
        subIds.set(subKey, r.rows[0].id);
      }
    }

    for (const item of items) {
      const subId = subIds.get(item.main + "||" + item.sub);
      const isBag = item.main === BAGS_MAIN_CATEGORY;
      const canContainItems = isBag || item.attrNames.includes(CONTAINS_ITEMS_ATTR);
      const canBeContained = !isBag;
      await client.query(
        `INSERT INTO items (id, sub_id, name, can_be_contained, can_have_nearby, can_contain_items)
         VALUES ($1,$2,$3,$4,true,$5)`,
        [item.id, subId, item.name, canBeContained, canContainItems]
      );
    }

    // --- attributes (item-scoped), from טבלת מאפיינים ---
    const attrIds = new Map();
    async function ensureAttribute(name, input_type, values, scope) {
      if (attrIds.has(name)) return attrIds.get(name);
      const r = await client.query(
        `INSERT INTO attributes (name, input_type, scope) VALUES ($1,$2,$3) RETURNING id`,
        [name, input_type, scope]
      );
      const attrId = r.rows[0].id;
      attrIds.set(name, attrId);
      for (let i = 0; i < values.length; i++) {
        await client.query(
          `INSERT INTO attribute_values (attribute_id, value, display_order) VALUES ($1,$2,$3)
           ON CONFLICT (attribute_id, value) DO NOTHING`,
          [attrId, values[i], i]
        );
      }
      return attrId;
    }

    for (const item of items) {
      let order = 0;
      for (const name of item.attrNames) {
        if (EXCLUDED_ATTRS.has(name)) continue;
        const def = attrDefs.get(name) || { input_type: "text", values: [] };
        const attrId = await ensureAttribute(name, def.input_type, def.values, "item");
        await client.query(
          `INSERT INTO item_attributes (item_id, attribute_id, display_order, weight)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [item.id, attrId, order++, weightFor(name)]
        );
      }
    }

    // --- universal attributes (location/date — not sheet-derived, unchanged) ---
    for (let i = 0; i < universal.length; i++) {
      const u = universal[i];
      const attrId = await ensureAttribute(u.name, u.input_type, u.values || [], "universal");
      await client.query(
        `INSERT INTO universal_attributes (attribute_id, display_order, weight) VALUES ($1,$2,$3)`,
        [attrId, i, u.weight]
      );
    }

    await client.query("COMMIT");
    console.log(
      `Seeded ${items.length} items, ${mainIds.size} main categories, ${subIds.size} sub categories, ${attrIds.size} attributes.`
    );
    if (unmatched.length) {
      console.log(`\n${unmatched.length} items landed in שונות (no exact match in the category tree):`);
      console.log(unmatched.join(", "));
    }
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
