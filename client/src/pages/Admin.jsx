import { useEffect, useRef, useState } from "react";
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

// "item1, item2, item3 ועוד 5" — short summary of which items share a question
function sharedSummary(names, max = 4) {
  if (names.length <= max) return names.join(", ");
  return names.slice(0, max).join(", ") + ` ועוד ${names.length - max}`;
}

// "+ add a question" form. For items it can either link an existing (shared) question — so the
// item uses the same answer list as every other item asking it — or create a brand-new one.
// onSubmit gets { existingId } or { payload: {name, input_type, values} }. alwaysOpen/submitLabel/
// disabled are for the bulk "add to several items" panel.
function NewAttributeForm({ onSubmit, allowExisting, alwaysOpen, submitLabel = "+ הוסף שאלה", disabled }) {
  const [open, setOpen] = useState(!!alwaysOpen);
  const [mode, setMode] = useState(allowExisting ? "existing" : "new");
  const [existing, setExisting] = useState([]);
  const [existingId, setExistingId] = useState(null);
  const [name, setName] = useState("");
  const [inputType, setInputType] = useState("single");
  const [valuesText, setValuesText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && allowExisting) api.adminListAttributes().then(setExisting);
  }, [open, allowExisting]);

  const ready = mode === "existing" ? !!existingId : !!name.trim();

  async function submit() {
    if (!ready || disabled) return;
    setBusy(true);
    try {
      if (mode === "existing") {
        await onSubmit({ existingId });
      } else {
        const values = inputType === "single" || inputType === "multi" ? parseValuesInput(valuesText) : [];
        await onSubmit({ payload: { name: name.trim(), input_type: inputType, values } });
      }
      setName("");
      setValuesText("");
      setExistingId(null);
      if (!alwaysOpen) setOpen(false);
      else if (allowExisting) api.adminListAttributes().then(setExisting);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <button className="admin-add-btn" onClick={() => setOpen(true)}>+ הוסף שאלה</button>;
  }

  return (
    <div className="q-card">
      <div className="q-card-body">
        {allowExisting && (
          <div className="opts" style={{ marginBottom: 10 }}>
            <button type="button" className={"opt-btn" + (mode === "existing" ? " sel" : "")} onClick={() => setMode("existing")}>
              שאלה קיימת (רשימה משותפת)
            </button>
            <button type="button" className={"opt-btn" + (mode === "new" ? " sel" : "")} onClick={() => setMode("new")}>
              שאלה חדשה
            </button>
          </div>
        )}
        {mode === "existing" && (
          <div style={{ marginBottom: 10 }}>
            <label>בחר/י שאלה</label>
            <select value={existingId || ""} onChange={(e) => setExistingId(Number(e.target.value) || null)}>
              <option value="">— בחר/י —</option>
              {existing.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.item_count} פריטים{a.item_names.length ? ": " + sharedSummary(a.item_names, 3) : ""})
                </option>
              ))}
            </select>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              השאלה תשתמש באותה רשימת תשובות כמו שאר הפריטים — שינוי ברשימה ישפיע על כולם.
            </p>
          </div>
        )}
        {mode === "new" && <>
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
        </>}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm btn-pr" onClick={submit} disabled={!ready || disabled || busy}>
            {busy ? "מוסיף..." : submitLabel}
          </button>
          {!alwaysOpen && <button className="btn btn-sm" onClick={() => setOpen(false)}>ביטול</button>}
        </div>
      </div>
    </div>
  );
}

// One question's full editor card: rename, required toggle, weight, and — for choice-type
// questions — its answer options. Shared by item-specific and universal (base) questions, so
// both get exactly the same editing power.
function QuestionCard({ attr, onRename, onSetWeight, onSetRequired, onSetAllowOther, onAddValue, onDeleteValue, onReorderValues, onRemoveFromItem, onDeleteEntirely }) {
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
  const shared = attr.shared_items || [];

  // drag-to-reorder answer tags with pointer events (mouse and touch alike): the list is reordered
  // live as the pointer passes over other tags, and saved on release. "אחר..." values stay pinned
  // last (the server always sorts them last too).
  const [dragList, setDragList] = useState(null);
  const dragId = useRef(null);
  const isOtherValue = (v) => v.value.startsWith("אחר");
  const shownValues = dragList || attr.values;

  function startDrag(e, v) {
    if (isOtherValue(v) || e.button > 0 || e.target.closest(".tag-x")) return;
    e.preventDefault();
    const original = attr.values;
    let list = original;
    let lastSwap = null; // the tag we just swapped with — ignored until the pointer leaves it, so tags of different widths don't flip back and forth
    dragId.current = v.id;
    setDragList(list);

    const move = (ev) => {
      const overId = Number(document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-vid]")?.dataset.vid);
      if (!overId || overId === v.id) return;
      if (overId === lastSwap) return;
      const from = list.findIndex((x) => x.id === v.id);
      const to = list.findIndex((x) => x.id === overId);
      if (to < 0 || isOtherValue(list[to])) return;
      const next = [...list];
      next.splice(to, 0, next.splice(from, 1)[0]);
      list = next;
      lastSwap = overId;
      setDragList(next);
    };
    const leave = (ev) => {
      const overId = Number(document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-vid]")?.dataset.vid);
      if (overId !== lastSwap) lastSwap = null;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointermove", leave);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      dragId.current = null;
      setDragList(null);
      if (list.some((x, i) => x.id !== original[i]?.id)) onReorderValues(list);
    };
    window.addEventListener("pointermove", leave);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

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
          {isChoice && (
            <label className={"req-toggle" + (attr.allow_other !== false ? " on" : "")} title='האם להציג למשתמש את האפשרות "אחר" עם מילוי חופשי'>
              <input type="checkbox" checked={attr.allow_other !== false} onChange={(e) => onSetAllowOther(e.target.checked)} />
              אפשר "אחר"
            </label>
          )}
          <input
            className="score-pill"
            type="number"
            title="משקל בניקוד התאמה"
            value={attr.weight}
            onChange={(e) => onSetWeight(Number(e.target.value))}
          />
          {onRemoveFromItem && (
            <button className="btn btn-sm" onClick={onRemoveFromItem} title="השאלה תוסר רק מהפריט הזה, ותישאר בשאר הפריטים">
              הסר מהפריט הזה בלבד
            </button>
          )}
          <button className="btn btn-sm btn-da" onClick={onDeleteEntirely} title="השאלה תימחק מכל הפריטים שיש להם אותה">
            {onRemoveFromItem ? `מחק מכל הפריטים (${shared.length || 1})` : "מחק שאלה זו"}
          </button>
        </div>
      </div>
      {shared.length > 1 && (
        <div className="muted" style={{ fontSize: 12, padding: "8px 14px 0" }} title={shared.join(", ")}>
          🔗 משותפת ל-{shared.length} פריטים: {sharedSummary(shared)} — שינוי בשם או ברשימה ישפיע על כולם
        </div>
      )}
      {isChoice && (
        <div className="q-card-body">
          <div className="chip-row">
            {shownValues.map((v) => (
              <span
                className={"tag" + (isOtherValue(v) ? "" : " tag-drag") + (dragList && dragId.current === v.id ? " dragging" : "")}
                key={v.id}
                data-vid={v.id}
                onPointerDown={(e) => startDrag(e, v)}
              >
                {v.value}
                <button type="button" className="tag-x" title="הסר תשובה זו" onClick={() => onDeleteValue(v)}>✕</button>
              </span>
            ))}
            {!attr.values.length && <span className="muted">אין ערכים מוגדרים עדיין</span>}
          </div>
          {attr.values.length > 1 && (
            <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              ניתן לגרור תשובה כדי לשנות את הסדר. התשובה הימנית ביותר תוצג ראשונה.
            </p>
          )}
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

// Add one question (existing/shared or brand-new) to many items at once: tick items, pick the
// question, submit. Items that already ask the question are left as they are.
function BulkAddPanel({ items, onClose }) {
  const [checked, setChecked] = useState(new Set());
  const [search, setSearch] = useState("");
  const [result, setResult] = useState(null);

  const q = search.trim().toLowerCase();
  const shown = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items;
  const grouped = {};
  for (const it of shown) (grouped[it.main_name + " / " + it.sub_name] ||= []).push(it);

  function toggle(ids, on) {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });
    setResult(null);
  }

  async function submit({ existingId, payload }) {
    const ids = [...checked];
    if (existingId) await api.adminLinkAttribute(existingId, ids);
    else await api.adminCreateAttribute({ ...payload, item_ids: ids });
    setResult(`✓ השאלה נוספה ל-${ids.length} פריטים`);
    setChecked(new Set());
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>☑️ הוספת שאלה לכמה פריטים בבת אחת</span>
        <button className="btn btn-sm" onClick={onClose}>סגור</button>
      </div>
      <div className="admin-section">
        <label>1. סמנו את הפריטים ({checked.size} נבחרו)</label>
        <div className="admin-search">
          <input type="text" placeholder="חיפוש פריט..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <button className="btn btn-sm" onClick={() => toggle(shown.map((it) => it.id), true)}>סמן את כל המוצגים ({shown.length})</button>
          <button className="btn btn-sm" onClick={() => setChecked(new Set())} disabled={!checked.size}>נקה בחירה</button>
        </div>
        <div className="admin-tree" style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--r)", marginBottom: 16 }}>
          {Object.entries(grouped).map(([group, its]) => (
            <div key={group}>
              <div className="admin-tree-group">{group}</div>
              {its.map((it) => (
                <label key={it.id} className="admin-tree-item" style={{ gap: 8, justifyContent: "flex-start", cursor: "pointer" }}>
                  <input type="checkbox" style={{ width: "auto", margin: 0 }} checked={checked.has(it.id)} onChange={(e) => toggle([it.id], e.target.checked)} />
                  <span>{it.name}</span>
                </label>
              ))}
            </div>
          ))}
          {!shown.length && <p className="muted" style={{ padding: 8 }}>לא נמצאו פריטים.</p>}
        </div>

        <label>2. בחרו את השאלה</label>
        <NewAttributeForm
          allowExisting
          alwaysOpen
          disabled={!checked.size}
          submitLabel={checked.size ? `+ הוסף ל-${checked.size} פריטים` : "סמנו פריטים קודם"}
          onSubmit={submit}
        />
        {result && <p style={{ color: "#15803d", fontWeight: 600 }}>{result}</p>}
      </div>
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
  const [bulkOpen, setBulkOpen] = useState(false);

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
    setBulkOpen(false);
    const a = await api.adminGetItemAttributes(item.id);
    setAttrs(a);
  }

  function selectUniversal(id) {
    setSelectedUniversalId(id);
    setSelectedItem(null);
    setBulkOpen(false);
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
    // keep "אחר..." values last, same as the server's ordering
    const isOther = (v) => v.value.startsWith("אחר");
    const patch = (a) => {
      if (a.id !== attrId) return a;
      const values = [...a.values.filter((v) => v.id !== r.id), { id: r.id, value }];
      return { ...a, values: [...values.filter((v) => !isOther(v)), ...values.filter(isOther)] };
    };
    if (fromUniversal) setUniversal((prev) => prev.map(patch));
    else setAttrs((prev) => prev.map(patch));
  }

  async function setAllowOther(attrId, allow_other) {
    await api.adminSetItemAttrAllowOther(selectedItem.id, attrId, allow_other);
    setAttrs((prev) => prev.map((a) => (a.id === attrId ? { ...a, allow_other } : a)));
  }

  async function setUniversalAllowOther(attrId, allow_other) {
    await api.adminSetUniversalAllowOther(attrId, allow_other);
    setUniversal((prev) => prev.map((a) => (a.id === attrId ? { ...a, allow_other } : a)));
  }

  async function reorderValues(attrId, values, fromUniversal) {
    const patch = (a) => (a.id === attrId ? { ...a, values } : a);
    if (fromUniversal) setUniversal((prev) => prev.map(patch));
    else setAttrs((prev) => prev.map(patch));
    try {
      await api.adminReorderValues(attrId, values.map((v) => v.id));
    } catch {
      window.alert("שמירת הסדר נכשלה, נסו שוב.");
    }
  }

  // a value used by past reports is hidden (not deleted) server-side — either way it leaves the list
  async function deleteValue(attr, value, fromUniversal) {
    const sharedNote = attr.shared_items?.length > 1 ? `\nהרשימה משותפת ל-${attr.shared_items.length} פריטים — התשובה תוסר מכולם.` : "";
    if (!window.confirm(`להסיר את התשובה "${value.value}" מהשאלה "${attr.name}"?${sharedNote}`)) return;
    try {
      await api.adminDeleteValue(value.id);
    } catch {
      window.alert("ההסרה נכשלה, נסו שוב.");
      return;
    }
    const patch = (a) => (a.id === attr.id ? { ...a, values: a.values.filter((v) => v.id !== value.id) } : a);
    if (fromUniversal) setUniversal((prev) => prev.map(patch));
    else setAttrs((prev) => prev.map(patch));
  }

  async function addItemAttribute({ existingId, payload }) {
    if (existingId) await api.adminLinkAttribute(existingId, [selectedItem.id]);
    else await api.adminCreateAttribute({ ...payload, item_id: selectedItem.id });
    const a = await api.adminGetItemAttributes(selectedItem.id);
    setAttrs(a);
  }

  async function addUniversalAttribute({ payload }) {
    await api.adminCreateAttribute({ ...payload, universal: true });
    loadUniversal();
  }

  async function removeItemAttribute(attr) {
    if (!window.confirm(`להסיר את השאלה "${attr.name}" מהפריט "${selectedItem.name}" בלבד?\nהשאלה תישאר בשאר הפריטים.`)) return;
    await api.adminRemoveItemAttribute(selectedItem.id, attr.id);
    setAttrs((prev) => prev.filter((a) => a.id !== attr.id));
  }

  async function deleteAttributeEntirely(attrId, fromUniversal) {
    const attr = (fromUniversal ? universal : attrs).find((a) => a.id === attrId);
    const n = attr?.shared_items?.length || 1;
    const msg = fromUniversal
      ? `למחוק את שאלת הבסיס "${attr?.name}" לגמרי?\nהיא לא תופיע יותר בדיווחים, והתשובות שניתנו לה בדיווחים קיימים יימחקו.`
      : `למחוק את השאלה "${attr?.name}" מכל ${n} הפריטים שיש להם אותה?\nהתשובות שניתנו לה בדיווחים קיימים יימחקו.\n\nאם רוצים להסיר רק מהפריט הזה — לחצו ביטול ובחרו "הסר מהפריט הזה בלבד".`;
    if (!window.confirm(msg)) return;
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
            <NewAttributeForm onSubmit={addUniversalAttribute} />
          </div>

          <div className="admin-panel-h" style={{ borderTop: "1px solid var(--border)" }}>🗂️ פריטים ({items.length})</div>
          <div className="admin-section">
            <button
              className="admin-add-btn"
              style={{ marginBottom: 8 }}
              onClick={() => { setBulkOpen(true); setSelectedItem(null); setSelectedUniversalId(null); }}
            >
              ☑️ הוספת שאלה לכמה פריטים
            </button>
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
          {bulkOpen && <BulkAddPanel items={items} onClose={() => setBulkOpen(false)} />}

          {!bulkOpen && !selectedItem && !selectedUniversal && (
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
                  onSetAllowOther={(on) => setUniversalAllowOther(selectedUniversal.id, on)}
                  onAddValue={(v) => addValue(selectedUniversal.id, v, true)}
                  onDeleteValue={(v) => deleteValue(selectedUniversal, v, true)}
                  onReorderValues={(values) => reorderValues(selectedUniversal.id, values, true)}
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
                      "האם היו דברים בתוך הפריט?" (2–5 פריטים)
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
                    onSetAllowOther={(on) => setAllowOther(a.id, on)}
                    onAddValue={(v) => addValue(a.id, v, false)}
                    onDeleteValue={(v) => deleteValue(a, v, false)}
                    onReorderValues={(values) => reorderValues(a.id, values, false)}
                    onRemoveFromItem={() => removeItemAttribute(a)}
                    onDeleteEntirely={() => deleteAttributeEntirely(a.id, false)}
                  />
                ))}

                <NewAttributeForm allowExisting onSubmit={addItemAttribute} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
