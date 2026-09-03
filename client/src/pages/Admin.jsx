import { useEffect, useState } from "react";
import { api } from "../api";

function OtherAnswersPanel() {
  const [rows, setRows] = useState([]);
  const [retroactive, setRetroactive] = useState({});

  function load() { api.adminOtherAnswers().then(setRows); }
  useEffect(load, []);

  async function promote(row) {
    await api.adminPromoteOther(row.attribute_id, row.text, !!retroactive[row.sample_id]);
    load();
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-h">תשובות "אחר" שנצברו</div>
      <div className="card-b">
        {!rows.length && <p className="muted">אין כרגע תשובות "אחר" הממתינות לסקירה.</p>}
        {rows.map((r) => (
          <div key={r.attribute_id + "|" + r.text} className="row" style={{ alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: 10, marginBottom: 10 }}>
            <div className="col">
              <div><b>{r.attribute_name}</b> — "{r.text}"</div>
              <div className="muted" style={{ fontSize: 12 }}>הופיע {r.count} פעמים</div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={!!retroactive[r.sample_id]}
                onChange={(e) => setRetroactive((p) => ({ ...p, [r.sample_id]: e.target.checked }))}
              />
              עדכן גם דיווחים קיימים
            </label>
            <button className="btn btn-sm btn-pr" onClick={() => promote(r)}>+ הוסף לרשימה</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryEditor({ item, categories, onMoved }) {
  const [subId, setSubId] = useState(item.sub_id);
  const [newSubName, setNewSubName] = useState("");
  const [newSubMain, setNewSubMain] = useState(item.main_id);

  useEffect(() => setSubId(item.sub_id), [item.sub_id]);

  async function move() {
    if (subId === item.sub_id) return;
    await api.adminMoveItemCategory(item.id, subId);
    onMoved();
  }

  async function addSub() {
    if (!newSubName) return;
    await api.adminAddSubcategory(newSubMain, newSubName);
    setNewSubName("");
    onMoved(true);
  }

  return (
    <div style={{ marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
      <label>שיוך קטגוריה</label>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="col">
          <select value={subId} onChange={(e) => setSubId(Number(e.target.value))}>
            {categories.map((m) => (
              <optgroup label={m.name} key={m.id}>
                {m.subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="col" style={{ flex: "0 0 120px" }}>
          <button className="btn btn-sm" onClick={move} disabled={subId === item.sub_id}>שנה שיוך</button>
        </div>
      </div>
      <label style={{ marginTop: 8 }}>הוספת תת-קטגוריה חדשה</label>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="col" style={{ flex: "0 0 160px" }}>
          <select value={newSubMain} onChange={(e) => setNewSubMain(Number(e.target.value))}>
            {categories.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="col">
          <input type="text" placeholder="שם תת-קטגוריה..." value={newSubName} onChange={(e) => setNewSubName(e.target.value)} />
        </div>
        <div className="col" style={{ flex: "0 0 100px" }}>
          <button className="btn btn-sm btn-pr" onClick={addSub}>+ הוסף</button>
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  const [items, setItems] = useState([]);
  const [universal, setUniversal] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [attrs, setAttrs] = useState([]);
  const [newValue, setNewValue] = useState({});

  function loadItems() { api.adminListItems().then(setItems); }
  useEffect(() => {
    loadItems();
    api.adminGetUniversalAttributes().then(setUniversal);
    api.adminCategories().then(setCategories);
  }, []);

  async function selectItem(item) {
    setSelectedItem(item);
    const a = await api.adminGetItemAttributes(item.id);
    setAttrs(a);
  }

  async function reloadAfterCategoryChange(refreshCategories) {
    await loadItems();
    if (refreshCategories) await api.adminCategories().then(setCategories);
    if (selectedItem) {
      const fresh = await api.adminListItems();
      const updated = fresh.find((i) => i.id === selectedItem.id);
      if (updated) setSelectedItem(updated);
    }
  }

  async function setFlag(flag, checked) {
    const updated = await api.adminSetItemFlags(selectedItem.id, { [flag]: checked });
    setSelectedItem((prev) => ({ ...prev, ...updated }));
    setItems((prev) => prev.map((it) => (it.id === selectedItem.id ? { ...it, ...updated } : it)));
  }

  async function setWeight(attrId, weight) {
    await api.adminSetItemAttrWeight(selectedItem.id, attrId, weight);
    setAttrs((prev) => prev.map((a) => (a.id === attrId ? { ...a, weight } : a)));
  }

  async function setUniversalWeight(attrId, weight) {
    await api.adminSetUniversalWeight(attrId, weight);
    setUniversal((prev) => prev.map((a) => (a.id === attrId ? { ...a, weight } : a)));
  }

  async function addValue(attrId) {
    const value = newValue[attrId];
    if (!value) return;
    const r = await api.adminAddValue(attrId, value);
    setAttrs((prev) => prev.map((a) => (a.id === attrId ? { ...a, values: [...a.values, { id: r.id, value }] } : a)));
    setNewValue((p) => ({ ...p, [attrId]: "" }));
  }

  async function deleteValue(attrId, valueId) {
    await api.adminDeleteValue(valueId);
    setAttrs((prev) => prev.map((a) => (a.id === attrId ? { ...a, values: a.values.filter((v) => v.id !== valueId) } : a)));
  }

  const grouped = {};
  for (const it of items) {
    const key = it.main_name + " / " + it.sub_name;
    (grouped[key] ||= []).push(it);
  }

  return (
    <div className="page page-wide">
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ width: 260, flexShrink: 0, background: "var(--white)", border: "1px solid var(--border)", borderRadius: "var(--rl)", overflow: "hidden", boxShadow: "var(--shadow)" }}>
          <div style={{ padding: "11px 14px", background: "#f8fafc", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }}>
            מאפיינים אוניברסליים
          </div>
          <div style={{ padding: 8 }}>
            {universal.map((a) => (
              <div className="tree-item" key={a.id}>
                <span>{a.name}</span>
                <input
                  className="score-pill"
                  type="number"
                  value={a.weight}
                  onChange={(e) => setUniversalWeight(a.id, Number(e.target.value))}
                />
              </div>
            ))}
          </div>
          <div style={{ padding: "11px 14px", background: "#f8fafc", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }}>
            פריטים
          </div>
          <div style={{ padding: 8, maxHeight: 500, overflowY: "auto" }}>
            {Object.entries(grouped).map(([group, its]) => (
              <div key={group}>
                <div className="tree-group-label">{group}</div>
                {its.map((it) => (
                  <div key={it.id} className={"tree-item tree-child" + (selectedItem?.id === it.id ? " act" : "")} onClick={() => selectItem(it)}>
                    <span>{it.name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedItem && (
            <div className="card"><div className="card-b muted">בחר פריט מהרשימה כדי לערוך את השאלות והמשקלים שלו.</div></div>
          )}
          {selectedItem && (
            <div className="card">
              <div className="card-h">עריכת שדות — {selectedItem.name}</div>
              <div className="card-b">
                <CategoryEditor item={selectedItem} categories={categories} onMoved={reloadAfterCategoryChange} />

                <div style={{ marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                  <label>שאלות מיוחדות</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={!!selectedItem.can_contain_items} onChange={(e) => setFlag("can_contain_items", e.target.checked)} />
                      לשאול "מה היה בפנים?" (עד 4 פריטים)
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={!!selectedItem.can_be_contained} onChange={(e) => setFlag("can_be_contained", e.target.checked)} />
                      לשאול "האם הפריט היה בתוך משהו?"
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={!!selectedItem.can_have_nearby} onChange={(e) => setFlag("can_have_nearby", e.target.checked)} />
                      לשאול "האם היו פריטים נוספים בסמוך?"
                    </label>
                  </div>
                </div>

                {!attrs.length && <p className="muted">לפריט זה אין שאלות מוגדרות.</p>}
                {attrs.map((a) => (
                  <div key={a.id} style={{ marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                    <div className="row" style={{ alignItems: "flex-end" }}>
                      <div className="col">
                        <label>שאלה</label>
                        <input type="text" value={a.name} disabled />
                      </div>
                      <div className="col" style={{ flex: "0 0 140px" }}>
                        <label>משקל בניקוד התאמה</label>
                        <input type="number" value={a.weight} onChange={(e) => setWeight(a.id, Number(e.target.value))} />
                      </div>
                    </div>
                    {(a.input_type === "single" || a.input_type === "multi") && (
                      <div style={{ marginTop: 8 }}>
                        <label>ערכים אפשריים</label>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 8 }}>
                          {a.values.map((v) => (
                            <span className="tag" key={v.id}>{v.value} <x onClick={() => deleteValue(a.id, v.id)}>✕</x></span>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input type="text" placeholder="ערך חדש..." value={newValue[a.id] || ""} onChange={(e) => setNewValue((p) => ({ ...p, [a.id]: e.target.value }))} />
                          <button className="btn btn-pr btn-sm" onClick={() => addValue(a.id)}>+ הוסף</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <OtherAnswersPanel />
    </div>
  );
}
