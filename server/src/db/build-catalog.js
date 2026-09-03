// Builds the full item/category/attribute catalog from the source spreadsheet
// (source-data/mtziot-avidot.xlsx). Run standalone (`node build-catalog.js`) to inspect
// the output/report before seeding, or require it from seed.js.
//
// Sheets used:
//  - "מסד נתונים קטגוריות"    -> authoritative category tree (main, sub, item), no IDs.
//  - "שיוך פריט למאפיינים"    -> item catalog: id, (main, sub — NOT trusted), item name,
//                                 ordered list of attribute names that apply to it.
//  - "טבלת מאפיינים"          -> attribute definitions: name, single/multi flag, value list.
//
// Items are placed in the tree by matching their NAME (normalized) against the tree's
// item names — not by trusting the item sheet's own category columns, since those don't
// always agree with the tree (see build report). Items with no match go to שונות/שונות.

const path = require("path");
const XLSX = require("xlsx");

const SOURCE_PATH = path.join(__dirname, "source-data", "mtziot-avidot.xlsx");
const FALLBACK_MAIN = "שונות";
const FALLBACK_SUB = "שונות";

function normalize(s) {
  if (s == null) return "";
  return String(s)
    .replace(/ /g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/");
}

function singularPluralVariants(s) {
  const out = new Set([s]);
  if (s.endsWith("ים")) out.add(s.slice(0, -2));
  else out.add(s + "ים");
  if (s.endsWith("ות")) out.add(s.slice(0, -2));
  else out.add(s + "ות");
  return [...out];
}

function loadWorkbook() {
  return XLSX.readFile(SOURCE_PATH);
}

function sheetRows(wb, name) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
}

// ---- 1. category tree ----
function buildTree(wb) {
  const rows = sheetRows(wb, "מסד נתונים קטגוריות").slice(1);
  // main -> Map(sub -> Set(item))
  const tree = new Map();
  // itemName(normalized) -> [{main, sub, item}] (for lookup; item names aren't globally unique, e.g. "אחר")
  const byItemName = new Map();
  // sub-category name -> [{main, sub}] — items that name themselves after their whole sub-category
  // (e.g. sheet item "כלי נגינה" == the sub-category "כלי נגינה" itself)
  const bySubName = new Map();

  function addNode(main, sub, item) {
    if (!tree.has(main)) tree.set(main, new Map());
    const subs = tree.get(main);
    if (!subs.has(sub)) subs.set(sub, new Set());
    if (item) subs.get(sub).add(item);
  }

  function indexItemName(key, entry) {
    if (!byItemName.has(key)) byItemName.set(key, []);
    const list = byItemName.get(key);
    if (!list.some((e) => e.main === entry.main && e.sub === entry.sub && e.item === entry.item)) list.push(entry);
  }

  for (const r of rows) {
    const main = normalize(r[0]);
    const sub = normalize(r[1]) || normalize(r[0]); // some rows have no sub — item lives directly under main
    const item = normalize(r[2]);
    if (!main) continue;
    addNode(main, sub, item);
    if (item) {
      const entry = { main, sub, item };
      indexItemName(item, entry);
      // reverse-index paren-stripped / slash-split forms so e.g. sheet "כרית" finds tree "כרית (שינה)",
      // and sheet "שמיכה" finds tree "שמיכה/שק שינה"
      const stripped = item.replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (stripped && stripped !== item) indexItemName(stripped, entry);
      if (item.includes("/")) {
        for (const part of item.split("/")) {
          const p = part.trim();
          if (p) indexItemName(p, entry);
        }
      }
      if (!bySubName.has(sub)) bySubName.set(sub, []);
      if (!bySubName.get(sub).some((e) => e.main === main && e.sub === sub)) bySubName.get(sub).push({ main, sub });
    } else {
      if (!bySubName.has(sub)) bySubName.set(sub, []);
      if (!bySubName.get(sub).some((e) => e.main === main && e.sub === sub)) bySubName.get(sub).push({ main, sub });
    }
  }

  addNode(FALLBACK_MAIN, FALLBACK_SUB, null);

  return { tree, byItemName, bySubName };
}

// A couple of cells in "טבלת מאפיינים" are editorial notes, not real selectable values:
//  - an instruction left in the "למי מתאים" column ("if it's a skirt, don't give ...")
//  - "אפשרות לכמה צבעים" (a "multiple colors" placeholder) — moot now that color is a genuine
//    multi-select attribute, since the reporter just checks several real colors directly.
const NOTE_VALUES = new Set(['אם זה חצאית, לא לתת את כל האפשרויות הנ"ל', "אפשרות לכמה צבעים"]);

// ---- 2. attribute definitions ----
function buildAttributeDefs(wb) {
  const rows = sheetRows(wb, "טבלת מאפיינים");
  const flagRow = rows[1]; // "בחירה (1) / בחירה מרובה (2)"
  const nameRow = rows[2]; // "רשימת מאפיין"
  const valueRows = rows.slice(3);

  const defs = new Map(); // name -> { input_type: 'single'|'multi', values: [] }
  const maxCol = Math.max(nameRow.length, flagRow.length, ...valueRows.map((r) => r.length));

  for (let c = 1; c < maxCol; c++) {
    const name = normalize(nameRow[c]);
    if (!name) continue;
    const flag = normalize(flagRow[c]);
    const input_type = flag === "2" ? "multi" : "single";
    const values = [];
    for (const r of valueRows) {
      const v = normalize(r[c]);
      if (v && !NOTE_VALUES.has(v)) values.push(v);
    }
    defs.set(name, { input_type, values });
  }
  return defs;
}

// ---- 3. item catalog (id, name, attribute names) ----
function buildItemRows(wb) {
  const rows = sheetRows(wb, "שיוך פריט למאפיינים").slice(1);
  const out = [];
  for (const r of rows) {
    const id = r[0];
    const main = normalize(r[1]);
    const sub = normalize(r[2]);
    const name = normalize(r[3]);
    if (typeof id !== "number" || main === "DELETED" || !name) continue;
    const attrNames = [];
    for (let c = 4; c < r.length; c++) {
      const a = normalize(r[c]);
      if (a) attrNames.push(a);
    }
    out.push({ id, sheetMain: main, sheetSub: sub, name, attrNames });
  }
  return out;
}

// ---- 4. match items to the tree ----
function matchItemToTree(item, byItemName, bySubName) {
  const candidates = [item.name, ...singularPluralVariants(item.name)];

  // strip "(...)" qualifiers, e.g. "כוסות (לא חד פעמי)" -> "כוסות"
  const stripped = item.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (stripped && stripped !== item.name) candidates.push(stripped, ...singularPluralVariants(stripped));

  // "X/Y" -> try X and Y individually
  if (item.name.includes("/")) {
    for (const part of item.name.split("/")) {
      const p = part.trim();
      if (p) candidates.push(p);
    }
  }

  for (const c of candidates) {
    const hits = byItemName.get(c);
    if (!hits) continue;
    if (hits.length === 1) return { ...hits[0], matchedBy: c };
    // ambiguous name (e.g. "אחר", "מפיץ ריח" appearing under 2+ subs) — disambiguate using the
    // sheet's own sub-category when possible, otherwise take the first tree occurrence
    const bySub = hits.find((h) => h.sub === item.sheetSub);
    if (bySub) return { ...bySub, matchedBy: c + " (+sub)" };
    return { ...hits[0], matchedBy: c + " (ambiguous, first match)" };
  }

  // "אחר <holiday/topic>" -> "אחר" within the matching sub
  if (item.name.startsWith("אחר ") || item.name.startsWith("אחר")) {
    const hits = byItemName.get("אחר") || [];
    const bySub = hits.find((h) => h.sub === item.sheetSub);
    if (bySub) return { ...bySub, matchedBy: "אחר (+sub, generic-other)" };
  }

  // item name equals a whole sub-category name (e.g. sheet "כלי נגינה" == sub-category "כלי נגינה")
  const subHits = bySubName.get(item.name);
  if (subHits && subHits.length === 1) return { ...subHits[0], matchedBy: "sub-name" };
  if (subHits && subHits.length > 1) {
    const bySheetMain = subHits.find((h) => h.main === item.sheetMain);
    if (bySheetMain) return { ...bySheetMain, matchedBy: "sub-name (+main)" };
  }

  return null;
}

function buildCatalog() {
  const wb = loadWorkbook();
  const { tree, byItemName, bySubName } = buildTree(wb);
  const attrDefs = buildAttributeDefs(wb);
  const itemRows = buildItemRows(wb);

  const placedItems = [];
  const unmatched = [];
  const placedNames = new Set(); // (main||sub||name) already covered by a sheet-1 item

  for (const item of itemRows) {
    const match = matchItemToTree(item, byItemName, bySubName);
    const placement = match || { main: FALLBACK_MAIN, sub: FALLBACK_SUB };
    if (!match) unmatched.push(item.name);
    placedItems.push({
      id: item.id,
      main: placement.main,
      sub: placement.sub,
      name: item.name,
      attrNames: item.attrNames,
      matchedBy: match ? match.matchedBy : null,
    });
    if (match) placedNames.add(`${match.main}||${match.sub}||${match.item}`);
  }

  // The tree ("מסד נתונים קטגוריות") is the authoritative catalog of *selectable* items — it has
  // ~50 items with no row in "שיוך פריט למאפיינים" at all (no extra questions defined for them).
  // Add them too, with no attributes, so the picker reflects the full tree, not just the subset
  // that happens to have a question set. Synthetic ids start well above the real sheet id range.
  let syntheticId = 5000;
  const treeOnly = [];
  for (const [main, subs] of tree) {
    for (const [sub, itemSet] of subs) {
      if (itemSet.size === 0) {
        // sub-category with no items listed at all (e.g. "מפתחות וצ'יפים") — the sub/main name
        // itself is the selectable item, same self-referential pattern the sheet already uses
        // elsewhere ("מזון ומוצרי מכולת" -> "מזון ומוצרי מכולת").
        const key = `${main}||${sub}||${sub}`;
        if (!placedNames.has(key)) {
          placedNames.add(key);
          treeOnly.push({ id: syntheticId++, main, sub, name: sub, attrNames: [], matchedBy: "tree-only (self)" });
        }
        continue;
      }
      for (const item of itemSet) {
        const key = `${main}||${sub}||${item}`;
        if (placedNames.has(key)) continue;
        placedNames.add(key);
        treeOnly.push({ id: syntheticId++, main, sub, name: item, attrNames: [], matchedBy: "tree-only" });
      }
    }
  }
  placedItems.push(...treeOnly);

  return { tree, attrDefs, items: placedItems, unmatched, treeOnlyCount: treeOnly.length };
}

if (require.main === module) {
  const { tree, attrDefs, items, unmatched, treeOnlyCount } = buildCatalog();
  let subCount = 0;
  for (const subs of tree.values()) subCount += subs.size;
  console.log(`mains: ${tree.size}, subs: ${subCount}`);
  console.log(`attributes defined: ${attrDefs.size}`);
  console.log(`items total: ${items.length} (from attribute sheet: ${items.length - treeOnlyCount}, tree-only no questions: ${treeOnlyCount}), unmatched -> שונות: ${unmatched.length}`);
  const dupIds = new Map();
  for (const it of items) dupIds.set(it.id, (dupIds.get(it.id) || 0) + 1);
  const dups = [...dupIds.entries()].filter(([, c]) => c > 1);
  console.log(`duplicate ids: ${dups.length}`, dups.slice(0, 10));
  console.log("\nunmatched item names:");
  console.log(unmatched.join("\n"));
}

module.exports = { buildCatalog };
