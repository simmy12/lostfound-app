import { useEffect, useState } from "react";
import { api } from "../api";

const INPUT_TYPE_LABEL = { single: "בחירה אחת", multi: "בחירה מרובה", text: "טקסט חופשי", number: "מספר" };

function OtherAnswersPanel() {
  const [rows, setRows] = useState([]);
  const [retroactive, setRetroactive] = useState({});
  const [reassignValue, setReassignValue] = useState({});

  function load() { api.adminOtherAnswers().then(setRows); }
  useEffect(load, []);

  async function promote(row) {
    await api.adminPromoteOther(row.attribute_id, row.text, !!retroactive[row.sample_id]);
    load();
  }

  async function reassign(row) {
    const valueId = reassignValue[row.sample_id];
    if (!valueId) return;
    await api.adminReassignOtherAnswer(row.attribute_id, row.text, valueId);
    load();
  }

  if (!rows.length) return null;

  return (
    <div className="admin-panel">
      <div className="admin-panel-h">💬 תשובות "אחר" שנצברו בשאלות על הפריט ({rows.length})</div>
      <div className="admin-section">
        {rows.map((r) => (
          <div key={r.attribute_id + "|" + r.text} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 10, marginBottom: 10 }}>
            <div><b>{r.attribute_name}</b> — "{r.text}"</div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>הופיע {r.count} פעמים</div>
            <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 0 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!!retroactive[r.sample_id]}
                  onChange={(e) => setRetroactive((p) => ({ ...p, [r.sample_id]: e.target.checked }))}
                />
                עדכן גם דיווחים קיימים
              </label>
              <button className="btn btn-sm btn-pr" onClick={() => promote(r)}>+ הוסף לרשימה</button>
              {!!r.values?.length && (
                <>
                  <select
                    style={{ width: "auto" }}
                    value={reassignValue[r.sample_id] || ""}
                    onChange={(e) => setReassignValue((p) => ({ ...p, [r.sample_id]: Number(e.target.value) || null }))}
                  >
                    <option value="">— שייך לערך קיים —</option>
                    {r.values.map((v) => <option key={v.id} value={v.id}>{v.value}</option>)}
                  </select>
                  <button className="btn btn-sm" onClick={() => reassign(r)} disabled={!reassignValue[r.sample_id]}>שייך</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// One report where the reporter couldn't find their item and typed free text instead
// (items.is_other_placeholder). The admin either reassigns it to an existing item, or approves
// it by creating a new item (in a category they pick) and reassigning the report to that.
function OtherItemRow({ row, categories, onDone, onCatalogChanged }) {
  const [mode, setMode] = useState(null); // null | "existing" | "new"
  const [mainId, setMainId] = useState(null);
  const [subId, setSubId] = useState(null);
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState(null);
  const [name, setName] = useState(row.other_item_text);

  const main = categories.find((m) => m.id === mainId);
  const subs = main?.subs || [];

  useEffect(() => {
    if (mode === "existing" && subId) api.getItems(subId).then(setItems);
    else setItems([]);
  }, [mode, subId]);

  async function reassign() {
    if (!itemId) return;
    await api.adminReassignOtherItem(row.report_id, itemId);
    onDone();
  }

  async function approve() {
    if (!subId || !name.trim()) return;
    await api.adminApproveOtherItem(row.report_id, subId, name.trim());
    onDone();
    onCatalogChanged(); // a brand-new item was just created — refresh the items sidebar so it shows up
  }

  return (
    <div className="row" style={{ alignItems: "flex-start", borderBottom: "1px solid var(--border)", paddingBottom: 10, marginBottom: 10 }}>
      <div className="col">
        <div><b>#{row.report_id}</b> ({row.type === "lost" ? "אבידה" : "מציאה"}) — "{row.other_item_text}"</div>
        <div className="opts" style={{ marginTop: 6 }}>
          <button type="button" className={"opt-btn" + (mode === "existing" ? " sel" : "")} onClick={() => setMode("existing")}>שינוי לפריט קיים</button>
          <button type="button" className={"opt-btn" + (mode === "new" ? " sel" : "")} onClick={() => setMode("new")}>אישור כפריט חדש</button>
        </div>

        {mode === "existing" && (
          <div className="row" style={{ marginTop: 8, alignItems: "flex-end" }}>
            <div className="col">
              <select value={mainId || ""} onChange={(e) => { setMainId(Number(e.target.value) || null); setSubId(null); setItemId(null); }}>
                <option value="">— קטגוריה —</option>
                {categories.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="col">
              <select value={subId || ""} onChange={(e) => { setSubId(Number(e.target.value) || null); setItemId(null); }} disabled={!mainId}>
                <option value="">— תת-קטגוריה —</option>
                {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="col">
              <select value={itemId || ""} onChange={(e) => setItemId(Number(e.target.value) || null)} disabled={!subId}>
                <option value="">— פריט —</option>
                {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select>
            </div>
            <div className="col" style={{ flex: "0 0 90px" }}>
              <button className="btn btn-sm btn-pr" onClick={reassign} disabled={!itemId}>עדכן</button>
            </div>
          </div>
        )}

        {mode === "new" && (
          <div className="row" style={{ marginTop: 8, alignItems: "flex-end" }}>
            <div className="col">
              <select value={mainId || ""} onChange={(e) => { setMainId(Number(e.target.value) || null); setSubId(null); }}>
                <option value="">— קטגוריה —</option>
                {categories.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="col">
              <select value={subId || ""} onChange={(e) => setSubId(Number(e.target.value) || null)} disabled={!mainId}>
                <option value="">— תת-קטגוריה —</option>
                {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="col">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="שם הפריט..." />
            </div>
            <div className="col" style={{ flex: "0 0 110px" }}>
              <button className="btn btn-sm btn-pr" onClick={approve} disabled={!subId || !name.trim()}>אשר והוסף</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Review queue for reports whose reporter picked "אחר" (couldn't find their item) and typed free
// text describing it — mirrors OtherAnswersPanel but at the item level, not the attribute level.
function OtherItemsPanel({ onCatalogChanged }) {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);

  function load() { api.adminOtherItems().then(setRows); }
  useEffect(() => {
    load();
    api.adminCategories().then(setCategories);
  }, []);

  if (!rows.length) return null;

  return (
    <div className="admin-panel">
      <div className="admin-panel-h">📥 דיווחים עם פריט "אחר" הממתינים לסקירה ({rows.length})</div>
      <div className="admin-section">
        {rows.map((r) => (
          <OtherItemRow key={r.report_id} row={r} categories={categories} onDone={load} onCatalogChanged={onCatalogChanged} />
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
    <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
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
      <div className="row" style={{ alignItems: "flex-end", marginBottom: 0 }}>
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

// values textarea: one value per line (or comma-separated), blanks dropped
function parseValuesInput(text) {
  return text.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
}

// Inline "+ add a new question" form, used both for a specific item and for universal questions.
function NewAttributeForm({ onCreate }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [inputType, setInputType] = useState("single");
  const [valuesText, setValuesText] = useState("");

  async function create() {
    if (!name.trim()) return;
    const values = inputType === "single" || inputType === "multi" ? parseValuesInput(valuesText) : [];
    await onCreate({ name: name.trim(), input_type: inputType, values });
    setName("");
    setValuesText("");
    setOpen(false);
  }

  if (!open) {
    return <button className="admin-add-btn" onClick={() => setOpen(true)}>+ הוסף שאלה</button>;
  }

  return (
    <div className="q-card">
      <div className="q-card-body">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="col">
            <label>שם השאלה</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: חברה" autoFocus />
          </div>
          <div className="col" style={{ flex: "0 0 150px" }}>
            <label>סוג</label>
            <select value={inputType} onChange={(e) => setInputType(e.target.value)}>
              <option value="single">בחירה אחת</option>
              <option value="multi">בחירה מרובה</option>
              <option value="text">טקסט חופשי</option>
              <option value="number">מספר</option>
            </select>
          </div>
        </div>
        {(inputType === "single" || inputType === "multi") && (
          <div style={{ marginBottom: 10 }}>
            <label>רשימת ערכים (אחד בכל שורה)</label>
            <textarea value={valuesText} onChange={(e) => setValuesText(e.target.value)} placeholder={"אדום\nכחול\nירוק"} />
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm btn-pr" onClick={create} disabled={!name.trim()}>+ הוסף שאלה</button>
          <button className="btn btn-sm" onClick={() => setOpen(false)}>ביטול</button>
        </div>
      </div>
    </div>
  );
}

// One question's full editor card: rename, required toggle, weight, and — for choice-type
// questions — its answer options. Shared by item-specific and universal (base) questions, so
// both get exactly the same editing power.
function QuestionCard({ attr, onRename, onSetWeight, onSetRequired, onAddValue, onDeleteValue, onRemoveFromItem, onDeleteEntirely }) {
  const [name, setName] = useState(attr.name);
  const [newValue, setNewValue] = useState("");
  const [nameStatus, setNameStatus] = useState(null); // null | "saving" | "saved" | error text

  useEffect(() => setName(attr.name), [attr.name]);

  const nameDirty = name.trim() !== attr.name;

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === attr.name) return setName(attr.name);
    setNameStatus("saving");
    try {
      await onRename(trimmed);
      setNameStatus("saved");
      setTimeout(() => setNameStatus((s) => (s === "saved" ? null : s)), 2000);
    } catch (e) {
      setNameStatus(e.message || "השמירה נכשלה");
    }
  }

  function cancelName() {
    setName(attr.name);
    setNameStatus(null);
  }

  async function addValue() {
    if (!newValue.trim()) return;
    await onAddValue(newValue.trim());
    setNewValue("");
  }

  const isChoice = attr.input_type === "single" || attr.input_type === "multi";

  return (
    <div className="q-card">
      <div className="q-card-top">
        <div className="q-card-name-wrap">
          <input
            className="q-card-name"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameStatus(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName();
              if (e.key === "Escape") cancelName();
            }}
            title="לחיצה לעריכת שם השאלה"
          />
          {nameDirty && (
            <>
              <button className="btn btn-sm btn-pr" onClick={saveName} disabled={!name.trim() || nameStatus === "saving"}>
                {nameStatus === "saving" ? "שומר..." : "שמור"}
              </button>
              <button className="btn btn-sm" onClick={cancelName}>ביטול</button>
            </>
          )}
          {nameStatus === "saved" && <span className="muted">✓ נשמר</span>}
          {nameStatus && nameStatus !== "saving" && nameStatus !== "saved" && (
            <span className="muted" style={{ color: "var(--da)" }}>השמירה נכשלה</span>
          )}
          <span className="badge badge-gray">{INPUT_TYPE_LABEL[attr.input_type] || attr.input_type}</span>
        </div>
        <div className="q-card-actions">
          <label className={"req-toggle" + (attr.required ? " on" : "")}>
            <input type="checkbox" checked={!!attr.required} onChange={(e) => onSetRequired(e.target.checked)} />
            חובה
          </label>
          <input
            className="score-pill"
            type="number"
            title="משקל בניקוד התאמה"
            value={attr.weight}
            onChange={(e) => onSetWeight(Number(e.target.value))}
          />
          {onRemoveFromItem && <button className="btn btn-sm" onClick={onRemoveFromItem}>הסר מפריט זה</button>}
          <button className="btn btn-sm btn-da" onClick={onDeleteEntirely}>מחק לצמיתות</button>
        </div>
      </div>
      {isChoice && (
        <div className="q-card-body">
          <div className="chip-row">
            {attr.values.map((v) => (
              <span className="tag" key={v.id}>{v.value} <x onClick={() => onDeleteValue(v.id)}>✕</x></span>
            ))}
            {!attr.values.length && <span className="muted">אין ערכים מוגדרים עדיין</span>}
          </div>
          <div className="chip-add-row">
            <input
              type="text"
              placeholder="ערך חדש..."
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addValue(); }}
            />
            <button className="btn btn-sm btn-pr" onClick={addValue}>+ הוסף ערך</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Admin() {
  const [items, setItems] = useState([]);
  const [universal, setUniversal] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedUniversalId, setSelectedUniversalId] = useState(null);
  const [attrs, setAttrs] = useState([]);
  const [search, setSearch] = useState("");
  const [showNewItemForm, setShowNewItemForm] = useState(false);
  const [newItemMain, setNewItemMain] = useState(null);
  const [newItemSub, setNewItemSub] = useState(null);
  const [newItemName, setNewItemName] = useState("");

  function loadItems() { api.adminListItems().then(setItems); }
  function loadUniversal() { api.adminGetUniversalAttributes().then(setUniversal); }
  useEffect(() => {
    loadItems();
    loadUniversal();
    api.adminCategories().then(setCategories);
  }, []);

  async function selectItem(item) {
    setSelectedItem(item);
    setSelectedUniversalId(null);
    const a = await api.adminGetItemAttributes(item.id);
    setAttrs(a);
  }

  function selectUniversal(id) {
    setSelectedUniversalId(id);
    setSelectedItem(null);
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

  async function setRequired(attrId, required) {
    await api.adminSetItemAttrRequired(selectedItem.id, attrId, required);
    setAttrs((prev) => prev.map((a) => (a.id === attrId ? { ...a, required } : a)));
  }

  async function setUniversalRequired(attrId, required) {
    await api.adminSetUniversalRequired(attrId, required);
    setUniversal((prev) => prev.map((a) => (a.id === attrId ? { ...a, required } : a)));
  }

  async function renameAttribute(attrId, name, fromUniversal) {
    await api.adminRenameAttribute(attrId, name);
    if (fromUniversal) setUniversal((prev) => prev.map((a) => (a.id === attrId ? { ...a, name } : a)));
    else setAttrs((prev) => prev.map((a) => (a.id === attrId ? { ...a, name } : a)));
  }

  async function addValue(attrId, value, fromUniversal) {
    const r = await api.adminAddValue(attrId, value);
    const patch = (a) => (a.id === attrId ? { ...a, values: [...a.values, { id: r.id, value }] } : a);
    if (fromUniversal) setUniversal((prev) => prev.map(patch));
    else setAttrs((prev) => prev.map(patch));
  }

  async function deleteValue(attrId, valueId, fromUniversal) {
    await api.adminDeleteValue(valueId);
    const patch = (a) => (a.id === attrId ? { ...a, values: a.values.filter((v) => v.id !== valueId) } : a);
    if (fromUniversal) setUniversal((prev) => prev.map(patch));
    else setAttrs((prev) => prev.map(patch));
  }

  async function addItemAttribute(payload) {
    await api.adminCreateAttribute({ ...payload, item_id: selectedItem.id });
    const a = await api.adminGetItemAttributes(selectedItem.id);
    setAttrs(a);
  }

  async function addUniversalAttribute(payload) {
    await api.adminCreateAttribute({ ...payload, universal: true });
    loadUniversal();
  }

  async function removeItemAttribute(attrId) {
    await api.adminRemoveItemAttribute(selectedItem.id, attrId);
    setAttrs((prev) => prev.filter((a) => a.id !== attrId));
  }

  async function deleteAttributeEntirely(attrId, fromUniversal) {
    if (!window.confirm("פעולה זו תמחק את השאלה הזו לצמיתות מכל המערכת, כולל מכל הדיווחים הקיימים שכוללים תשובה לשאלה הזו. להמשיך?")) return;
    await api.adminDeleteAttribute(attrId);
    if (fromUniversal) {
      setUniversal((prev) => prev.filter((a) => a.id !== attrId));
      if (selectedUniversalId === attrId) setSelectedUniversalId(null);
    } else {
      setAttrs((prev) => prev.filter((a) => a.id !== attrId));
    }
  }

  async function createItem() {
    if (!newItemSub || !newItemName.trim()) return;
    await api.adminCreateItem({ sub_id: newItemSub, name: newItemName.trim() });
    setNewItemName("");
    setNewItemMain(null);
    setNewItemSub(null);
    setShowNewItemForm(false);
    await loadItems();
  }

  const newItemSubs = categories.find((m) => m.id === newItemMain)?.subs || [];
  const selectedUniversal = universal.find((a) => a.id === selectedUniversalId);

  const q = search.trim().toLowerCase();
  const filteredItems = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items;
  const grouped = {};
  for (const it of filteredItems) {
    const key = it.main_name + " / " + it.sub_name;
    (grouped[key] ||= []).push(it);
  }

  return (
    <div className="page page-wide">
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 16 }}>
        <OtherItemsPanel onCatalogChanged={loadItems} />
        <OtherAnswersPanel />
      </div>

      <div className="admin-layout">
        <div className="admin-panel">
          <div className="admin-panel-h">📋 שאלות בסיס (נשאלות בכל דיווח)</div>
          <div className="admin-section">
            <div className="admin-tree">
              {universal.map((a) => (
                <div
                  key={a.id}
                  className={"admin-tree-item" + (selectedUniversalId === a.id ? " act" : "")}
                  onClick={() => selectUniversal(a.id)}
                >
                  <span>{a.name}</span>
                  {!!a.required && <span className="badge badge-wa">חובה</span>}
                </div>
              ))}
            </div>
          </div>
          <div className="admin-section">
            <NewAttributeForm onCreate={addUniversalAttribute} />
          </div>

          <div className="admin-panel-h" style={{ borderTop: "1px solid var(--border)" }}>🗂️ פריטים ({items.length})</div>
          <div className="admin-section">
            <div className="admin-search">
              <input type="text" placeholder="חיפוש פריט..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="admin-tree">
              {Object.entries(grouped).map(([group, its]) => (
                <div key={group}>
                  <div className="admin-tree-group">{group}</div>
                  {its.map((it) => (
                    <div
                      key={it.id}
                      className={"admin-tree-item" + (selectedItem?.id === it.id ? " act" : "")}
                      onClick={() => selectItem(it)}
                    >
                      <span>{it.name}</span>
                    </div>
                  ))}
                </div>
              ))}
              {!Object.keys(grouped).length && <p className="muted" style={{ padding: 8 }}>לא נמצאו פריטים.</p>}
            </div>
          </div>
          <div className="admin-section">
            {!showNewItemForm && (
              <button className="admin-add-btn" onClick={() => setShowNewItemForm(true)}>+ הוסף פריט חדש</button>
            )}
            {showNewItemForm && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <select value={newItemMain || ""} onChange={(e) => { setNewItemMain(Number(e.target.value) || null); setNewItemSub(null); }}>
                  <option value="">— קטגוריה —</option>
                  {categories.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <select value={newItemSub || ""} onChange={(e) => setNewItemSub(Number(e.target.value) || null)} disabled={!newItemMain}>
                  <option value="">— תת-קטגוריה —</option>
                  {newItemSubs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input type="text" value={newItemName} onChange={(e) => setNewItemName(e.target.value)} placeholder="שם הפריט..." />
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-sm btn-pr" style={{ flex: 1 }} onClick={createItem} disabled={!newItemSub || !newItemName.trim()}>+ הוסף</button>
                  <button className="btn btn-sm" onClick={() => setShowNewItemForm(false)}>ביטול</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          {!selectedItem && !selectedUniversal && (
            <div className="admin-panel">
              <div className="admin-empty">
                <div className="admin-empty-icon">🗂️</div>
                <div>בחר/י שאלת בסיס או פריט מהרשימה בצד כדי לערוך אותו.</div>
              </div>
            </div>
          )}

          {selectedUniversal && (
            <div className="admin-panel">
              <div className="admin-panel-h">עריכת שאלת בסיס</div>
              <div className="admin-section">
                <QuestionCard
                  attr={selectedUniversal}
                  onRename={(name) => renameAttribute(selectedUniversal.id, name, true)}
                  onSetWeight={(w) => setUniversalWeight(selectedUniversal.id, w)}
                  onSetRequired={(r) => setUniversalRequired(selectedUniversal.id, r)}
                  onAddValue={(v) => addValue(selectedUniversal.id, v, true)}
                  onDeleteValue={(vid) => deleteValue(selectedUniversal.id, vid, true)}
                  onDeleteEntirely={() => deleteAttributeEntirely(selectedUniversal.id, true)}
                />
              </div>
            </div>
          )}

          {selectedItem && (
            <div className="admin-panel">
              <div className="item-header">
                <div>
                  <div className="item-header-title">{selectedItem.name}</div>
                  <div className="item-header-sub">{selectedItem.main_name} / {selectedItem.sub_name}</div>
                </div>
              </div>
              <div className="admin-section">
                <CategoryEditor item={selectedItem} categories={categories} onMoved={reloadAfterCategoryChange} />

                <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
                  <label>שאלות מיוחדות</label>
                  <div className="flag-grid">
                    <label className="flag-chip">
                      <input type="checkbox" checked={!!selectedItem.can_contain_items} onChange={(e) => setFlag("can_contain_items", e.target.checked)} />
                      "מה היה בפנים?" (עד 4 פריטים)
                    </label>
                    <label className="flag-chip">
                      <input type="checkbox" checked={!!selectedItem.can_be_contained} onChange={(e) => setFlag("can_be_contained", e.target.checked)} />
                      "האם היה בתוך משהו?"
                    </label>
                    <label className="flag-chip">
                      <input type="checkbox" checked={!!selectedItem.can_have_nearby} onChange={(e) => setFlag("can_have_nearby", e.target.checked)} />
                      "פריטים נוספים בסמוך?"
                    </label>
                  </div>
                </div>

                {!attrs.length && <p className="muted" style={{ marginBottom: 12 }}>לפריט זה אין שאלות מוגדרות.</p>}
                {attrs.map((a) => (
                  <QuestionCard
                    key={a.id}
                    attr={a}
                    onRename={(name) => renameAttribute(a.id, name, false)}
                    onSetWeight={(w) => setWeight(a.id, w)}
                    onSetRequired={(r) => setRequired(a.id, r)}
                    onAddValue={(v) => addValue(a.id, v, false)}
                    onDeleteValue={(vid) => deleteValue(a.id, vid, false)}
                    onRemoveFromItem={() => removeItemAttribute(a.id)}
                    onDeleteEntirely={() => deleteAttributeEntirely(a.id, false)}
                  />
                ))}

                <NewAttributeForm onCreate={addItemAttribute} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
