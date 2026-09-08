import { useEffect, useState } from "react";
import { api } from "../api";

function fillClass(score) {
  if (score >= 75) return "fill-hi";
  if (score >= 50) return "fill-md";
  return "fill-lo";
}
function pctClass(score) {
  if (score >= 75) return "pct-hi";
  if (score >= 50) return "pct-md";
  return "pct-lo";
}
const TYPE_LABEL = { lost: "אבידות", found: "מציאות" };
const TYPE_LABEL_SINGULAR = { lost: "אבידה", found: "מציאה" };

// visual-only cue (not part of the match score) showing a report's container/content/nearby links,
// so a rep can eyeball whether the fuller picture makes sense — e.g. a found suitcase whose
// reported contents line up with a lost suitcase's reported contents.
function LinkBadges({ r }) {
  if (!r || (!r.container && !(r.contents?.length) && !(r.nearby?.length))) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
      {r.container && <span className="tag" style={{ background: "#fef3c7" }}>🧳 בתוך: {r.container.item_name}</span>}
      {r.contents?.map((c) => <span className="tag" key={"c" + c.report_id} style={{ background: "#dbeafe" }}>📦 תוכן: {c.item_name}</span>)}
      {r.nearby?.map((n) => <span className="tag" key={"n" + n.report_id} style={{ background: "#e5e7eb" }}>📍 סמוך: {n.item_name}</span>)}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={wide ? { maxWidth: 1000 } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <span>{title}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-b">{children}</div>
      </div>
    </div>
  );
}

// full detail of a single report: item, every answer, contact, free text, and its links
function ReportDetail({ r }) {
  if (!r) return <p className="muted">טוען...</p>;
  return (
    <div>
      <div className="detail-side-h">
        {r.item_name} #{r.id} — <span className={r.type === "lost" ? "pct-lo" : "pct-hi"}>{TYPE_LABEL_SINGULAR[r.type]}</span>
      </div>
      <div className="item-tags" style={{ marginBottom: 8 }}>
        <span className="item-tag">{r.main_name}</span>
        <span className="item-tag">{r.sub_name}</span>
        <span className="item-tag">{r.status}</span>
      </div>
      <LinkBadges r={r} />
      {r.answers?.map((a) => (
        <div className="sum-row" key={a.attribute_id}>
          <span className="sum-k">{a.attribute_name}</span>
          <span>{a.value || a.free_text || "—"}</span>
        </div>
      ))}
      {r.free_text && <div className="sum-row"><span className="sum-k">תיאור נוסף</span><span>{r.free_text}</span></div>}
      {r.note && <div className="sum-row"><span className="sum-k">הערה</span><span>{r.note}</span></div>}
      {(r.contact_name || r.contact_phone || r.contact_email) && (
        <>
          <div className="divider" />
          {r.contact_name && <div className="sum-row"><span className="sum-k">שם</span><span>{r.contact_name}</span></div>}
          {r.contact_phone && <div className="sum-row"><span className="sum-k">טלפון</span><span>{r.contact_phone}</span></div>}
          {r.contact_email && <div className="sum-row"><span className="sum-k">אימייל</span><span>{r.contact_email}</span></div>}
        </>
      )}
      <div className="sum-row"><span className="sum-k">תאריך דיווח</span><span>{new Date(r.created_at).toLocaleDateString("he-IL")}</span></div>
    </div>
  );
}

export default function RepSearch() {
  const [baseType, setBaseType] = useState("lost");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("open");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [matches, setMatches] = useState([]);

  const [compareWith, setCompareWith] = useState(null);
  const [compareDetail, setCompareDetail] = useState(null);

  const [fullDetail, setFullDetail] = useState(null);

  async function search(type = baseType) {
    const params = { status, type };
    if (q) params.q = q;
    const r = await api.searchReports(params);
    setResults(r);
  }
  useEffect(() => { search(); }, []);

  function switchSide(type) {
    setBaseType(type);
    setSelected(null);
    setDetail(null);
    setMatches([]);
    search(type);
  }

  async function selectBase(r) {
    setSelected(r.id);
    const d = await api.getReport(r.id);
    setDetail(d);
    const m = await api.getMatches(r.id);
    setMatches(m);
  }

  async function openCompare(matchId) {
    setCompareWith(matchId);
    const d = await api.getReport(matchId);
    setCompareDetail(d);
  }
  function closeCompare() {
    setCompareWith(null);
    setCompareDetail(null);
  }

  async function openFullDetail(reportId) {
    const d = await api.getReport(reportId);
    setFullDetail(d);
  }

  async function confirm() {
    if (!selected || !compareWith) return;
    await confirmPair(selected, compareWith);
  }
  async function confirmPair(id, otherId) {
    await api.confirmMatch(id, otherId);
    closeCompare();
    await selectBase({ id });
    search();
  }

  const rows = [];
  if (detail && compareDetail) {
    const byName = (r) => Object.fromEntries(r.answers.map((a) => [a.attribute_name, a.value || a.free_text]));
    const dMap = byName(detail);
    const cMap = byName(compareDetail);
    const names = new Set([...Object.keys(dMap), ...Object.keys(cMap)]);
    for (const name of names) {
      const match = dMap[name] && cMap[name] && dMap[name] === cMap[name];
      rows.push({ name, a: dMap[name] || "—", b: cMap[name] || "—", match });
    }
  }

  return (
    <div className="page page-wide">
      <div className="card">
        <div className="card-h">חיפוש דיווחים</div>
        <div className="card-b">
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="col" style={{ flex: "0 0 220px" }}>
              <label>מציג</label>
              <div className="side-toggle">
                <button className={baseType === "lost" ? "act" : ""} onClick={() => switchSide("lost")}>אבידות</button>
                <button className={baseType === "found" ? "act" : ""} onClick={() => switchSide("found")}>מציאות</button>
              </div>
            </div>
            <div className="col">
              <label>חיפוש חופשי</label>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי תיאור, שם פריט..." />
            </div>
            <div className="col">
              <label>סטטוס</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">הכל</option>
                <option value="open">פתוח</option>
                <option value="matched">מותאם</option>
                <option value="closed">סגור</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-pr" onClick={() => search()}>🔍 חפש</button>
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-h">{TYPE_LABEL[baseType]} <span className="badge badge-wa">{results.length}</span></div>
          <div className="panel-b">
            {results.map((r) => (
              <div key={r.id} className={"item-card" + (selected === r.id ? " sel" : "")} onClick={() => selectBase(r)}>
                <div className="item-meta">
                  <span className="item-title">{r.item_name} #{r.id}</span>
                  <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openFullDetail(r.id); }}>פרטים מלאים</button>
                </div>
                <div className="item-tags">
                  <span className="item-tag">{r.main_name}</span>
                  <span className="item-tag">{r.sub_name}</span>
                </div>
                <div className="item-footer">
                  <span>{new Date(r.created_at).toLocaleDateString("he-IL")}</span>
                  <span>{r.status}</span>
                </div>
                <LinkBadges r={r} />
              </div>
            ))}
            {!results.length && <p className="muted">אין תוצאות.</p>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            {TYPE_LABEL[baseType === "lost" ? "found" : "lost"]} מתאימות {detail ? `— ל${detail.item_name}` : ""}
            <span className="badge badge-pr">{matches.length}</span>
          </div>
          <div className="panel-b">
            {!detail && <p className="muted">בחר/י {TYPE_LABEL_SINGULAR[baseType]} מהרשימה כדי לראות התאמות אפשריות.</p>}
            {matches.map((m) => (
              <div key={m.id} className="item-card" onClick={() => openCompare(m.id)}>
                <div className="item-meta">
                  <span className="item-title">{m.item_name} #{m.id}</span>
                  <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openFullDetail(m.id); }}>פרטים מלאים</button>
                </div>
                <div className="match-bar"><div className={"match-fill " + fillClass(m.score)} style={{ width: m.score + "%" }} /></div>
                <div style={{ textAlign: "left", fontSize: 12, marginTop: 3 }} className={pctClass(m.score)}>{m.score}% התאמה</div>
                <LinkBadges r={m} />
              </div>
            ))}
            {detail && !matches.length && <p className="muted">לא נמצאו התאמות פתוחות כרגע.</p>}
          </div>
        </div>
      </div>

      {fullDetail && (
        <Modal title={`פרטים מלאים — #${fullDetail.id}`} onClose={() => setFullDetail(null)}>
          <ReportDetail r={fullDetail} />
        </Modal>
      )}

      {compareWith && (
        <Modal title={`השוואה — #${detail?.id} ↔ #${compareDetail?.id}`} onClose={closeCompare} wide>
          <div className="detail-grid" style={{ marginBottom: 16 }}>
            <ReportDetail r={detail} />
            <ReportDetail r={compareDetail} />
          </div>
          <table className="comp-table">
            <thead>
              <tr>
                <th>שדה</th>
                <th>{detail && TYPE_LABEL_SINGULAR[detail.type]}</th>
                <th style={{ textAlign: "center" }}>התאמה</th>
                <th>{compareDetail && TYPE_LABEL_SINGULAR[compareDetail.type]}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className={r.match ? "match" : "miss"}>
                  <td>{r.name}</td>
                  <td>{r.a}</td>
                  <td style={{ textAlign: "center" }}>{r.match ? "✓" : "✗"}</td>
                  <td>{r.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-actions">
            <span />
            <button className="btn btn-su" onClick={confirm}>✓ סמן כהתאמה</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
