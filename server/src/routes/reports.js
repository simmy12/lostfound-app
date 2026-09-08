const express = require("express");
const pool = require("../db/pool");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

const MAX_LINKED = 4;

function parseId(req, res, name = "id") {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: `${name} must be an integer` });
    return null;
  }
  return id;
}

// ---- create ----
// Payload:
// { type, item_id, free_text, contact_name, contact_phone, contact_email,
//   item_answers: [{attribute_id, value_id?|free_text?}, ...],   // this item's own questions
//   universal_answers: [...],                                    // location/date, main report only
//   contents:  [{ item_id, item_answers }, ...],   // up to 4 — "what was inside" (this item is a container)
//   container: { item_id, item_answers, contents? } | null,   // "what was it inside" (this item was
//     // inside something) — container.contents (up to 3) are other items found in that same
//     // container besides the main item, since it already fills one of the container's 4 slots
//   nearby:    [{ item_id, item_answers }, ...] }  // up to 4 — items found/lost nearby
//
// contents/container/nearby each become their own independent report, sharing the main report's
// universal (location/date) answers — asked once, applied to every report created in this submission.
router.post("/reports", asyncHandler(async (req, res) => {
  const {
    type,
    item_id,
    free_text,
    note,
    contact_name,
    contact_phone,
    contact_email,
    item_answers = [],
    universal_answers = [],
    contents = [],
    container = null,
    nearby = [],
  } = req.body;

  if (!["lost", "found"].includes(type) || !item_id) {
    return res.status(400).json({ error: "type and item_id are required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    async function insertReport(itemId, answers) {
      const r = await client.query(
        `INSERT INTO reports (type, item_id, free_text, note, contact_name, contact_phone, contact_email)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [type, itemId, free_text || null, note || null, contact_name || null, contact_phone || null, contact_email || null]
      );
      const reportId = r.rows[0].id;
      const allAnswers = [...answers, ...universal_answers];
      for (const a of allAnswers) {
        if (a.value_id == null && !a.free_text) continue;
        await client.query(
          `INSERT INTO report_attribute_values (report_id, attribute_id, value_id, free_text)
           VALUES ($1,$2,$3,$4) ON CONFLICT (report_id, attribute_id, value_id) DO NOTHING`,
          [reportId, a.attribute_id, a.value_id || null, a.free_text || null]
        );
      }
      return reportId;
    }

    const mainReportId = await insertReport(item_id, item_answers);

    for (const c of contents.slice(0, MAX_LINKED)) {
      const contentReportId = await insertReport(c.item_id, c.item_answers || []);
      await client.query(
        `INSERT INTO report_container_links (container_report_id, content_report_id) VALUES ($1,$2)`,
        [mainReportId, contentReportId]
      );
    }

    if (container) {
      const containerReportId = await insertReport(container.item_id, container.item_answers || []);
      await client.query(
        `INSERT INTO report_container_links (container_report_id, content_report_id) VALUES ($1,$2)`,
        [containerReportId, mainReportId]
      );
      // other items found in that same container (besides the original item), up to 3 —
      // the container's total capacity is still 4, one slot already used by the main item
      for (const c of (container.contents || []).slice(0, MAX_LINKED - 1)) {
        const extraContentReportId = await insertReport(c.item_id, c.item_answers || []);
        await client.query(
          `INSERT INTO report_container_links (container_report_id, content_report_id) VALUES ($1,$2)`,
          [containerReportId, extraContentReportId]
        );
      }
    }

    for (const n of nearby.slice(0, MAX_LINKED)) {
      const nearbyReportId = await insertReport(n.item_id, n.item_answers || []);
      const [a, b] = [mainReportId, nearbyReportId].sort((x, y) => x - y);
      await client.query(
        `INSERT INTO report_nearby_links (report_id_a, report_id_b) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [a, b]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ id: mainReportId });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "failed to create report" });
  } finally {
    client.release();
  }
}));

// ---- search / list (for the rep screen) ----
router.get("/reports", asyncHandler(async (req, res) => {
  const { type, status, main_id, sub_id, item_id, q, date_from, date_to, region, city } = req.query;
  const clauses = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  if (type) clauses.push(`r.type = ${p(type)}`);
  if (status) clauses.push(`r.status = ${p(status)}`);
  if (item_id) clauses.push(`r.item_id = ${p(item_id)}`);
  if (sub_id) clauses.push(`i.sub_id = ${p(sub_id)}`);
  if (main_id) clauses.push(`cs.main_id = ${p(main_id)}`);
  if (date_from) clauses.push(`r.created_at >= ${p(date_from)}`);
  if (date_to) clauses.push(`r.created_at <= ${p(date_to)}`);
  if (q) clauses.push(`(r.free_text ILIKE ${p("%" + q + "%")} OR i.name ILIKE ${p("%" + q + "%")})`);
  if (region) clauses.push(`EXISTS (SELECT 1 FROM report_attribute_values rav
     JOIN attributes a ON a.id = rav.attribute_id JOIN attribute_values av ON av.id = rav.value_id
     WHERE rav.report_id = r.id AND a.name = 'אזור ארץ' AND av.value = ${p(region)})`);
  if (city) clauses.push(`EXISTS (SELECT 1 FROM report_attribute_values rav
     JOIN attributes a ON a.id = rav.attribute_id
     WHERE rav.report_id = r.id AND a.name = 'עיר' AND rav.free_text ILIKE ${p("%" + city + "%")})`);

  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  const sql = `
    SELECT r.id, r.type, r.status, r.free_text, r.created_at, r.item_id,
           i.name AS item_name, cs.name AS sub_name, cm.name AS main_name
    FROM reports r
    JOIN items i ON i.id = r.item_id
    JOIN categories_sub cs ON cs.id = i.sub_id
    JOIN categories_main cm ON cm.id = cs.main_id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT 200`;
  const r = await pool.query(sql, params);
  const reports = r.rows;

  // attach lightweight container/content/nearby names so a rep can spot the fuller picture at a
  // glance — display-only, does not affect matching/scoring.
  if (reports.length) {
    const ids = reports.map((x) => x.id);
    const links = await linksFor(ids);
    for (const rep of reports) Object.assign(rep, links.get(rep.id));
  }

  res.json(reports);
}));

// resolves, for each report id: names of its contents (if it's a container), its container's
// name (if it's inside one), and names of nearby-linked reports.
async function linksFor(reportIds) {
  const result = new Map(reportIds.map((id) => [id, { contents: [], container: null, nearby: [] }]));
  if (!reportIds.length) return result;

  const contentsR = await pool.query(
    `SELECT rcl.container_report_id, rcl.content_report_id, i.name AS item_name, r.type, r.status
     FROM report_container_links rcl
     JOIN reports r ON r.id = rcl.content_report_id
     JOIN items i ON i.id = r.item_id
     WHERE rcl.container_report_id = ANY($1::int[])`,
    [reportIds]
  );
  for (const row of contentsR.rows) {
    if (!result.has(row.container_report_id)) result.set(row.container_report_id, { contents: [], container: null, nearby: [] });
    result.get(row.container_report_id).contents.push({ report_id: row.content_report_id, item_name: row.item_name, type: row.type, status: row.status });
  }

  const containerR = await pool.query(
    `SELECT rcl.content_report_id, rcl.container_report_id, i.name AS item_name, r.type, r.status
     FROM report_container_links rcl
     JOIN reports r ON r.id = rcl.container_report_id
     JOIN items i ON i.id = r.item_id
     WHERE rcl.content_report_id = ANY($1::int[])`,
    [reportIds]
  );
  for (const row of containerR.rows) {
    if (!result.has(row.content_report_id)) result.set(row.content_report_id, { contents: [], container: null, nearby: [] });
    result.get(row.content_report_id).container = { report_id: row.container_report_id, item_name: row.item_name, type: row.type, status: row.status };
  }

  // for each nearby pair touching one of our reports, attach the *other* side's item info to
  // whichever of our reports is present in that pair (usually both, if querying a whole result set)
  const pairsR = await pool.query(
    `SELECT rnl.report_id_a, rnl.report_id_b FROM report_nearby_links rnl
     WHERE rnl.report_id_a = ANY($1::int[]) OR rnl.report_id_b = ANY($1::int[])`,
    [reportIds]
  );
  const otherIds = new Set();
  for (const row of pairsR.rows) { otherIds.add(row.report_id_a); otherIds.add(row.report_id_b); }
  if (otherIds.size) {
    const namesR = await pool.query(
      `SELECT r.id, i.name AS item_name, r.type, r.status FROM reports r JOIN items i ON i.id = r.item_id
       WHERE r.id = ANY($1::int[])`,
      [[...otherIds]]
    );
    const nameById = new Map(namesR.rows.map((x) => [x.id, x]));
    for (const row of pairsR.rows) {
      for (const [anchor, other] of [[row.report_id_a, row.report_id_b], [row.report_id_b, row.report_id_a]]) {
        if (!reportIds.includes(anchor)) continue;
        if (!result.has(anchor)) result.set(anchor, { contents: [], container: null, nearby: [] });
        const info = nameById.get(other);
        if (info) result.get(anchor).nearby.push({ report_id: other, item_name: info.item_name, type: info.type, status: info.status });
      }
    }
  }

  return result;
}

// ---- detail ----
router.get("/reports/:id", asyncHandler(async (req, res) => {
  const id = parseId(req, res);
  if (id == null) return;
  const r = await pool.query(
    `SELECT r.*, i.name AS item_name, cs.name AS sub_name, cm.name AS main_name
     FROM reports r
     JOIN items i ON i.id = r.item_id
     JOIN categories_sub cs ON cs.id = i.sub_id
     JOIN categories_main cm ON cm.id = cs.main_id
     WHERE r.id = $1`,
    [id]
  );
  if (!r.rows.length) return res.status(404).json({ error: "not found" });
  const values = await pool.query(
    `SELECT rav.attribute_id, a.name AS attribute_name, a.scope, a.input_type, rav.value_id, av.value, rav.free_text
     FROM report_attribute_values rav
     JOIN attributes a ON a.id = rav.attribute_id
     LEFT JOIN attribute_values av ON av.id = rav.value_id
     WHERE rav.report_id = $1
     ORDER BY rav.attribute_id`,
    [id]
  );
  const links = await linksFor([id]);
  res.json({ ...r.rows[0], answers: values.rows, ...links.get(id) });
}));

// ---- matches, computed on demand ----
async function computeMatches(reportId) {
  const baseR = await pool.query(`SELECT * FROM reports WHERE id = $1`, [reportId]);
  if (!baseR.rows.length) return null;
  const base = baseR.rows[0];
  const oppositeType = base.type === "lost" ? "found" : "lost";

  const candidatesR = await pool.query(
    `SELECT * FROM reports WHERE type = $1 AND item_id = $2 AND status = 'open' AND id <> $3`,
    [oppositeType, base.item_id, reportId]
  );

  const weightsR = await pool.query(
    `SELECT ia.attribute_id, ia.weight, a.input_type FROM item_attributes ia
     JOIN attributes a ON a.id = ia.attribute_id WHERE ia.item_id = $1
     UNION ALL
     SELECT ua.attribute_id, ua.weight, a.input_type FROM universal_attributes ua
     JOIN attributes a ON a.id = ua.attribute_id`,
    [base.item_id]
  );
  const weightByAttr = new Map(weightsR.rows.map((w) => [w.attribute_id, w.weight]));
  const typeByAttr = new Map(weightsR.rows.map((w) => [w.attribute_id, w.input_type]));

  // attribute_id -> Set of value tokens ("v:<id>" for a picked value, "t:<text>" for free text)
  async function valuesFor(rid) {
    const r = await pool.query(
      `SELECT attribute_id, value_id, free_text FROM report_attribute_values WHERE report_id = $1`,
      [rid]
    );
    const map = new Map();
    for (const row of r.rows) {
      const token = row.value_id != null ? `v:${row.value_id}` : `t:${(row.free_text || "").trim().toLowerCase()}`;
      if (!map.has(row.attribute_id)) map.set(row.attribute_id, new Set());
      map.get(row.attribute_id).add(token);
    }
    return map;
  }

  function attrMatches(attrId, baseSet, candSet) {
    if (!candSet) return false;
    if (typeByAttr.get(attrId) === "multi") {
      for (const t of baseSet) if (candSet.has(t)) return true; // any overlap = full match
      return false;
    }
    // single-select (or text): full-set equality (in practice one value each)
    if (baseSet.size !== candSet.size) return false;
    for (const t of baseSet) if (!candSet.has(t)) return false;
    return true;
  }

  const baseValues = await valuesFor(reportId);
  const results = [];
  for (const cand of candidatesR.rows) {
    const candValues = await valuesFor(cand.id);
    let earned = 0;
    let possible = 0;
    for (const [attrId, weight] of weightByAttr) {
      const baseSet = baseValues.get(attrId);
      if (!baseSet || !baseSet.size) continue;
      possible += weight;
      if (attrMatches(attrId, baseSet, candValues.get(attrId))) earned += weight;
    }
    const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
    results.push({ report_id: cand.id, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

router.get("/reports/:id/matches", asyncHandler(async (req, res) => {
  const id = parseId(req, res);
  if (id == null) return;
  const results = await computeMatches(id);
  if (results === null) return res.status(404).json({ error: "not found" });
  if (!results.length) return res.json([]);

  const ids = results.map((r) => r.report_id);
  const detail = await pool.query(
    `SELECT r.id, r.type, r.status, r.free_text, r.created_at, i.name AS item_name,
            cs.name AS sub_name, cm.name AS main_name
     FROM reports r
     JOIN items i ON i.id = r.item_id
     JOIN categories_sub cs ON cs.id = i.sub_id
     JOIN categories_main cm ON cm.id = cs.main_id
     WHERE r.id = ANY($1::int[])`,
    [ids]
  );
  const byId = new Map(detail.rows.map((d) => [d.id, d]));
  const links = await linksFor(ids);
  res.json(results.map((r) => ({ ...byId.get(r.report_id), score: r.score, ...links.get(r.report_id) })));
}));

// ---- confirm a match ----
router.post("/reports/:id/matches/:otherId/confirm", asyncHandler(async (req, res) => {
  const id = parseId(req, res, "id");
  if (id == null) return;
  const otherId = parseId(req, res, "otherId");
  if (otherId == null) return;
  const baseR = await pool.query(`SELECT type FROM reports WHERE id = $1`, [id]);
  if (!baseR.rows.length) return res.status(404).json({ error: "not found" });
  const lostId = baseR.rows[0].type === "lost" ? id : otherId;
  const foundId = baseR.rows[0].type === "lost" ? otherId : id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO matches (lost_report_id, found_report_id, score, confirmed)
       VALUES ($1,$2,100,true)
       ON CONFLICT (lost_report_id, found_report_id) DO UPDATE SET confirmed = true`,
      [lostId, foundId]
    );
    await client.query(`UPDATE reports SET status = 'matched' WHERE id IN ($1,$2)`, [lostId, foundId]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "failed to confirm match" });
  } finally {
    client.release();
  }
}));

module.exports = router;
