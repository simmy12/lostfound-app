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

export default function RepSearch() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("open");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [matches, setMatches] = useState([]);
  const [compareWith, setCompareWith] = useState(null);

  async function search() {
    const params = { status };
    if (q) params.q = q;
    if (type) params.type = type;
    const r = await api.searchReports(params);
    setResults(r);
  }
  useEffect(() => { search(); }, []);

  async function select(r) {
    setSelected(r.id);
    setCompareWith(null);
    const d = await api.getReport(r.id);
    setDetail(d);
    const m = await api.getMatches(r.id);
    setMatches(m);
    if (m.length) {
      setCompareWith(m[0].report_id);
    }
  }

  const [compareDetail, setCompareDetail] = useState(null);
  useEffect(() => {
    if (compareWith) api.getReport(compareWith).then(setCompareDetail);
    else setCompareDetail(null);
  }, [compareWith]);

  async function confirm() {
    if (!selected || !compareWith) return;
    await api.confirmMatch(selected, compareWith);
    await select({ id: selected });
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
        <div className="card-h">
          חיפוש דיווחים
          <span className="badge badge-pr">נמצאו {results.length} תוצאות</span>
        </div>
        <div className="card-b">
          <div className="row">
            <div className="col">
              <label>חיפוש חופשי</label>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי תיאור, שם פריט..." />
            </div>
            <div className="col">
              <label>סוג</label>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">הכל</option>
                <option value="lost">אבדות</option>
                <option value="found">מציאות</option>
              </select>
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
            <button className="btn btn-pr" onClick={search}>🔍 חפש</button>
          </div>
        </div>
      </div>

      <div className="two-col" style={{ marginBottom: 16 }}>
        <div className="panel">
          <div className="panel-h">תוצאות חיפוש <span className="badge badge-wa">{results.length}</span></div>
          <div className="panel-b">
            {results.map((r) => (
              <div key={r.id} className={"item-card" + (selected === r.id ? " sel" : "")} onClick={() => select(r)}>
                <div className="item-meta">
                  <span className="item-title">{r.item_name} #{r.id}</span>
                  <span className="badge badge-wa">{r.type === "lost" ? "אבדה" : "מציאה"}</span>
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
            התאמות {detail ? `— ${detail.item_name}` : ""}
            <span className="badge badge-pr">{matches.length}</span>
          </div>
          <div className="panel-b">
            {!detail && <p className="muted">בחר דיווח כדי לראות התאמות אפשריות.</p>}
            {matches.map((m) => (
              <div key={m.report_id} className={"item-card" + (compareWith === m.report_id ? " sel" : "")} onClick={() => setCompareWith(m.report_id)}>
                <div className="item-meta">
                  <span className="item-title">{m.item_name} #{m.id}</span>
                  <span className="badge badge-su">{m.type === "lost" ? "אבדה" : "מציאה"}</span>
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

      {detail && compareDetail && (
        <div className="card">
          <div className="card-h">
            השוואה מפורטת — #{detail.id} ↔ #{compareDetail.id}
            <button className="btn btn-sm btn-su" onClick={confirm}>✓ סמן כהתאמה</button>
          </div>
          <div className="card-b">
            <div className="row" style={{ marginBottom: 10 }}>
              <div className="col"><LinkBadges r={detail} /></div>
              <div className="col"><LinkBadges r={compareDetail} /></div>
            </div>
            <table className="comp-table">
              <thead>
                <tr><th>שדה</th><th>{detail.type === "lost" ? "אבדה" : "מציאה"}</th><th style={{ textAlign: "center" }}>התאמה</th><th>{compareDetail.type === "lost" ? "אבדה" : "מציאה"}</th></tr>
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
          </div>
        </div>
      )}
    </div>
  );
}
