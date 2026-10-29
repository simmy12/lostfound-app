import { useEffect, useState } from "react";
import { api } from "../api";

const INPUT_TYPE_LABEL = { single: "בחירה אחת", multi: "בחירה מרובה", text: "טקסט חופשי", number: "מספר" };
const OTHER_VALUE_MSG = 'אין צורך להוסיף "אחר" כתשובה. כדי לאפשר למשתמש לבחור "אחר" ולפרט, סמנו את התיבה "אפשר אחר" בשאלה.';
const startsWithOther = (v) => v.trim().startsWith("אחר");

// question type select + (for multiple choice) the max number of answers; used when creating a
// question and when editing one
function TypePicker({ type, max, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
      <select value={type} onChange={(e) => onChange(e.target.value, max || 2)} style={{ width: "auto" }} title="סוג השאלה">
        {Object.entries(INPUT_TYPE_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {type === "multi" && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, margin: 0, whiteSpace: "nowrap", fontSize: 13, width: "auto", flexShrink: 0 }}>
          עד
          <input
            type="number"
            min={2}
            value={max || 2}
            onChange={(e) => onChange(type, Math.max(2, Number(e.target.value) || 2))}
            style={{ width: 60 }}
            title="כמה תשובות אפשר לבחור לכל היותר"
          />
          תשובות
        </label>
      )}
    </div>
  );
}

const isYesNoList = (values) => values.length === 2 && values.some((v) => v.value === "כן") && values.some((v) => v.value === "לא");

// Drag-to-reorder with pointer events (mouse and touch alike). Elements carry
// data-sort-group={group} data-sort-id={id}; the list reorders live as the pointer passes over
// another element of the same group and onReorder(newList) runs on release if the order changed.
// Pressing on a button/input inside an element doesn't start a drag.
function usePointerSort(list, group, onReorder, canMove = () => true) {
  const [dragList, setDragList] = useState(null);
  const [dragId, setDragId] = useState(null);

  function startDrag(e, item) {
    if (!canMove(item) || e.button > 0 || e.target.closest("button, input")) return;
    e.preventDefault();
    const original = list;
    let cur = original;
    let lastSwap = null; // just swapped with — ignored until the pointer leaves it, so items of different widths don't flip back and forth
    setDragId(item.id);
    setDragList(cur);

    const overIdAt = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(`[data-sort-group="${group}"]`);
      return el ? Number(el.dataset.sortId) : null;
    };
    const move = (ev) => {
      const overId = overIdAt(ev);
      if (overId !== lastSwap) lastSwap = null;
      if (!overId || overId === item.id || overId === lastSwap) return;
      const from = cur.findIndex((x) => x.id === item.id);
      const to = cur.findIndex((x) => x.id === overId);
      if (to < 0 || !canMove(cur[to])) return;
      const next = [...cur];
      next.splice(to, 0, next.splice(from, 1)[0]);
      cur = next;
      lastSwap = overId;
      setDragList(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDragId(null);
      setDragList(null);
      if (cur.some((x, i) => x.id !== original[i]?.id)) onReorder(cur);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  return { shown: dragList || list, startDrag, dragId };
}

// small inline text editor: Enter saves, Esc cancels
function InlineEdit({ initial, onSave, onCancel, width = 140 }) {
  const [text, setText] = useState(initial);
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input
        type="text"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(text.trim());
          if (e.key === "Escape") onCancel();
        }}
        style={{ width, padding: "2px 6px", fontSize: 13 }}
      />
      <button type="button" className="btn btn-sm btn-pr" onClick={() => onSave(text.trim())}>שמור</button>
      <button type="button" className="btn btn-sm" onClick={onCancel}>ביטול</button>
    </span>
  );
}

// This item's own "בתוך מה היה?" list: which items a reporter can pick as "it was inside this",
// in what order (drag). Add, remove, or replace it with a copy of another item's list. Every change
// saves the whole list at once.
function ItemContainersEditor({ item, items }) {
  const [list, setList] = useState([]);
  const [addId, setAddId] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [copyQ, setCopyQ] = useState("");
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    setMsg(null);
    api.adminItemContainers(item.id).then(setList);
  }, [item.id]);

  async function save(next) {
    setList(next);
    await api.adminSetItemContainers(item.id, next.map((x) => x.id));
  }

  const { shown, startDrag, dragId } = usePointerSort(list, "item-containers", save);

  async function remove(it) {
    if (!window.confirm(`האם את/ה בטוח/ה שברצונך להסיר את "${it.name}" מהרשימה של "${item.name}"?`)) return;
    save(list.filter((x) => x.id !== it.id));
  }

  function add() {
    const it = items.find((x) => x.id === Number(addId));
    if (!it) return;
    save([...list, { id: it.id, name: it.name }]);
    setAddId("");
  }

  async function copy() {
    const src = items.find((x) => x.id === Number(copyFrom));
    if (!src) return;
    const srcList = (await api.adminItemContainers(src.id)).filter((x) => x.id !== item.id);
    if (!window.confirm(`להחליף את הרשימה של "${item.name}" ברשימה של "${src.name}" (${srcList.length} פריטים)?`)) return;
    await save(srcList);
    setCopyFrom("");
    setMsg(`✓ הועתקה הרשימה של "${src.name}"`);
  }

  const inList = new Set(list.map((x) => x.id));
  const query = copyQ.trim();
  return (
    <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
      <label>רשימת "בתוך מה היה?" של {item.name}</label>
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
        מה המשתמש יכול לבחור כשהוא עונה ש{item.name} היה בתוך משהו. גררו לשינוי הסדר (העליון מוצג ראשון).
        {!item.can_be_contained && " שימו לב: השאלה \"האם היה בתוך משהו?\" כבוייה לפריט הזה (בשאלות מיוחדות)."}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {shown.map((it, i) => (
          <div
            key={it.id}
            data-sort-group="item-containers"
            data-sort-id={it.id}
            onPointerDown={(e) => startDrag(e, it)}
            className={"container-row" + (dragId === it.id ? " dragging" : "")}
          >
            <span className="muted" style={{ width: 22 }}>{i + 1}.</span>
            <span style={{ flex: 1, fontWeight: 600 }}>{it.name}{it.is_hidden && <span className="muted"> (מוסתר)</span>}</span>
            <button type="button" className="btn btn-sm btn-soft" onClick={() => remove(it)}>הסר</button>
          </div>
        ))}
        {!list.length && <p className="muted" style={{ margin: 0 }}>הרשימה ריקה. המשתמש יחפש בכל הפריטים.</p>}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <select value={addId} onChange={(e) => setAddId(e.target.value)}>
          <option value="">— הוספת פריט לרשימה —</option>
          {items.filter((x) => x.id !== item.id && !inList.has(x.id)).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.sub_name})</option>)}
        </select>
        <button className="btn btn-sm btn-pr" style={{ whiteSpace: "nowrap", flexShrink: 0 }} onClick={add} disabled={!addId}>+ הוסף</button>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input type="text" placeholder="חיפוש פריט להעתקה..." value={copyQ} onChange={(e) => setCopyQ(e.target.value)} style={{ flex: "1 1 140px" }} />
        <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} style={{ flex: "2 1 200px" }}>
          <option value="">— 📋 העתק רשימה מפריט אחר —</option>
          {items.filter((x) => x.id !== item.id && (!query || x.name.includes(query))).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.sub_name})</option>)}
        </select>
        <button className="btn btn-sm" style={{ whiteSpace: "nowrap", flexShrink: 0 }} onClick={copy} disabled={!copyFrom}>העתק</button>
        {msg && <span style={{ color: "#15803d", fontWeight: 600, fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  );
}

function OtherAnswersPanel() {
  const [rows, setRows] = useState([]);
  const [reassignValue, setReassignValue] = useState({});

  function load() { api.adminOtherAnswers().then(setRows); }
  useEffect(load, []);

  async function promote(row) {
    await api.adminPromoteOther(row.attribute_id, row.text, true);
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
            <div>{r.item_name && <span className="muted">{r.item_name} / </span>}<b>{r.attribute_name}</b> — "{r.text}"</div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>הופיע {r.count} פעמים</div>
            <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 0 }}>
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

  const [delSub, setDelSub] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [needsMove, setNeedsMove] = useState(null); // item count when the chosen sub-category isn't empty
  const subName = (id) => categories.flatMap((m) => m.subs.map((s) => ({ ...s, main: m.name }))).find((s) => s.id === Number(id));

  async function deleteSub() {
    if (!delSub) return;
    const s = subName(delSub);
    if (needsMove && !moveTo) return;
    const msg = needsMove
      ? `להעביר ${needsMove} פריטים ל"${subName(moveTo)?.name}" ולמחוק את תת-הקטגוריה "${s.name}"?`
      : `האם את/ה בטוח/ה שברצונך למחוק את תת-הקטגוריה "${s.name}"?`;
    if (!window.confirm(msg)) return;
    try {
      await api.adminDeleteSubcategory(Number(delSub), needsMove ? Number(moveTo) : undefined);
    } catch (e) {
      const m = /"count":(\d+)/.exec(e.message);
      if (m) return setNeedsMove(Number(m[1]));
      return window.alert("המחיקה נכשלה, נסו שוב.");
    }
    setDelSub("");
    setMoveTo("");
    setNeedsMove(null);
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
      <label style={{ marginTop: 8 }}>מחיקת תת-קטגוריה</label>
      <div className="row" style={{ alignItems: "flex-end", marginBottom: 0 }}>
        <div className="col">
          <select value={delSub} onChange={(e) => { setDelSub(e.target.value); setNeedsMove(null); setMoveTo(""); }}>
            <option value="">— בחר/י תת-קטגוריה למחיקה —</option>
            {categories.map((m) => (
              <optgroup label={m.name} key={m.id}>
                {m.subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        {needsMove && (
          <div className="col">
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">— יש בה {needsMove} פריטים. להעביר אותם ל: —</option>
              {categories.map((m) => (
                <optgroup label={m.name} key={m.id}>
                  {m.subs.filter((s) => s.id !== Number(delSub)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        <div className="col" style={{ flex: "0 0 auto" }}>
          <button className="btn btn-sm btn-soft" onClick={deleteSub} disabled={!delSub || (needsMove && !moveTo)}>
            {needsMove ? "העבר ומחק" : "מחק"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Copy questions from another item onto this one — everything comes along (answers and their
// order, follow-ups, type, max picks, required, "אחר", weight). Pick the item, untick what isn't wanted.
function CopyQuestionsPanel({ item, items, onDone }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [fromId, setFromId] = useState(null);
  const [srcQs, setSrcQs] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!fromId) return setSrcQs([]);
    api.adminGetItemAttributes(fromId).then((qs) => {
      setSrcQs(qs);
      setPicked(new Set(qs.map((x) => x.id)));
    });
  }, [fromId]);

  async function copy() {
    if (!fromId || !picked.size) return;
    const r = await api.adminCopyQuestions(item.id, fromId, [...picked]);
    setMsg(`✓ הועתקו ${r.count} שאלות`);
    setFromId(null);
    onDone();
  }

  if (!open) {
    return <button className="admin-add-btn" style={{ marginBottom: 10 }} onClick={() => { setOpen(true); setMsg(null); }}>📋 העתק שאלות מפריט אחר</button>;
  }
  const query = q.trim();
  const options = items.filter((it) => it.id !== item.id && (!query || it.name.includes(query)));
  return (
    <div className="q-card" style={{ marginBottom: 10 }}>
      <div className="q-card-body">
        <label>מאיזה פריט להעתיק שאלות? (כל שאלה מועתקת עם הכול: תשובות, סדר, פירוטים, חובה, "אחר")</label>
        <input type="text" placeholder="חיפוש פריט..." value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 6 }} />
        <select value={fromId || ""} onChange={(e) => setFromId(Number(e.target.value) || null)}>
          <option value="">— בחר/י פריט ({options.length}) —</option>
          {options.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.sub_name})</option>)}
        </select>
        {fromId && !srcQs.length && <p className="muted">לפריט הזה אין שאלות.</p>}
        {srcQs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "10px 0" }}>
            {srcQs.map((x) => (
              <label key={x.id} style={{ display: "flex", gap: 6, alignItems: "center", margin: 0, fontSize: 14, color: "var(--text)" }}>
                <input
                  type="checkbox"
                  style={{ width: "auto", margin: 0 }}
                  checked={picked.has(x.id)}
                  onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(x.id) : n.delete(x.id); return n; })}
                />
                <b>{x.name}</b>
                <span className="muted">({x.values.length ? x.values.map((v) => v.value).slice(0, 5).join(", ") + (x.values.length > 5 ? "…" : "") : INPUT_TYPE_LABEL[x.input_type]})</span>
              </label>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
          <button className="btn btn-sm btn-pr" onClick={copy} disabled={!fromId || !picked.size}>העתק {picked.size && fromId ? `(${picked.size})` : ""}</button>
          <button className="btn btn-sm" onClick={() => setOpen(false)}>סגור</button>
          {msg && <span style={{ color: "#15803d", fontWeight: 600, fontSize: 13 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

const DETAIL_KIND_LABEL = { "": "בלי פירוט", text: "שדה טקסט", letters_or_text: "אותיות (עד 5, תיבה לכל אות) או שם" };

// an answer's follow-up settings: what opens when a reporter picks it
function DetailSettings({ v, onSave, onClose }) {
  const [kind, setKind] = useState(v.detail_kind || "");
  const [prompt, setPrompt] = useState(v.detail_prompt || "");
  return (
    <div className="detail-settings">
      <div style={{ fontWeight: 700, marginBottom: 6 }}>פירוט לתשובה "{v.value}"</div>
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>כשהמשתמש בוחר בתשובה הזו, ייפתח לו שדה נוסף למילוי (למשל: "מה השם?").</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: "auto" }}>
          {Object.entries(DETAIL_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {kind && <input type="text" placeholder='מה לשאול? למשל "מה השם?"' value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ flex: 1, minWidth: 180 }} />}
        <button className="btn btn-sm btn-pr" onClick={() => onSave(kind || null, prompt)}>שמור</button>
        <button className="btn btn-sm" onClick={onClose}>ביטול</button>
      </div>
    </div>
  );
}

// values textarea: one value per line (or comma-separated), blanks dropped
function parseValuesInput(text) {
  return text.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
}

const isChoiceType = (t) => t === "single" || t === "multi";

// "מעיל / צבע" or "שאלת בסיס / אזור ארץ"
function listLabel(a) {
  return (a.scope === "universal" ? "שאלת בסיס" : a.item_names[0] || "—") + " / " + a.name;
}

// searchable dropdown over every question in the system (one per item, plus base questions)
function ListPicker({ lists, value, onChange, excludeId, choiceOnly }) {
  const [q, setQ] = useState("");
  const query = q.trim();
  const options = lists
    .filter((a) => a.id !== excludeId && (!choiceOnly || isChoiceType(a.input_type)))
    .map((a) => ({ id: a.id, label: listLabel(a) }))
    .filter((o) => !query || o.label.includes(query))
    .sort((x, y) => x.label.localeCompare(y.label, "he"));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <input type="text" placeholder="חיפוש לפי שם פריט או שאלה..." value={q} onChange={(e) => setQ(e.target.value)} />
      <select value={value || ""} onChange={(e) => onChange(Number(e.target.value) || null)}>
        <option value="">— בחר/י ({options.length}) —</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );
}

// "+ add a question" form. For items it can either copy an existing question (the item gets its
// own independent copy, answers included) or create a brand-new one.
// onSubmit gets { existingId } or { payload: {name, input_type, values} }. alwaysOpen/submitLabel/
// disabled are for the bulk "add to several items" panel.
function NewAttributeForm({ onSubmit, allowExisting, alwaysOpen, submitLabel = "+ הוסף שאלה", disabled }) {
  const [open, setOpen] = useState(!!alwaysOpen);
  const [mode, setMode] = useState(allowExisting ? "existing" : "new");
  const [existing, setExisting] = useState([]);
  const [existingId, setExistingId] = useState(null);
  const [name, setName] = useState("");
  const [inputType, setInputType] = useState("single");
  const [maxSelect, setMaxSelect] = useState(2);
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
        await onSubmit({ payload: { name: name.trim(), input_type: inputType, max_select: maxSelect, values: values.filter((v) => !startsWithOther(v)) } });
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
              העתק שאלה קיימת
            </button>
            <button type="button" className={"opt-btn" + (mode === "new" ? " sel" : "")} onClick={() => setMode("new")}>
              שאלה חדשה
            </button>
          </div>
        )}
        {mode === "existing" && (
          <div style={{ marginBottom: 10 }}>
            <label>בחר/י שאלה להעתקה</label>
            <ListPicker lists={existing.filter((a) => a.scope === "item")} value={existingId} onChange={setExistingId} />
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              תיווצר העתקה של השאלה עם כל התשובות שלה. שינויים בה לא ישפיעו על פריטים אחרים.
            </p>
          </div>
        )}
        {mode === "new" && <>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="col">
            <label>שם השאלה</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: חברה" autoFocus />
          </div>
          <div className="col" style={{ flex: "0 0 auto" }}>
            <label>סוג</label>
            <TypePicker type={inputType} max={maxSelect} onChange={(t, m) => { setInputType(t); setMaxSelect(m); }} />
          </div>
        </div>
        {(inputType === "single" || inputType === "multi") && (
          <div style={{ marginBottom: 10 }}>
            <label>רשימת ערכים (אחד בכל שורה). את "אחר" לא צריך להוסיף, הוא נקבע בתיבה "אפשר אחר".</label>
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
function QuestionCard({ attr, onRename, onSetType, onSetWeight, onSetRequired, onSetAllowOther, onAddValue, onDeleteValue, onDeleteValues, onSetValueDetail, onRenameValue, onReorderValues, onCopyValues, onDelete, sortProps, dragHandle, dragging }) {
  const [editingValueId, setEditingValueId] = useState(null);
  const [detailValueId, setDetailValueId] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [marked, setMarked] = useState(new Set());

  function toggleMark(id) {
    setMarked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function deleteMarked() {
    const vals = attr.values.filter((v) => marked.has(v.id));
    if (!vals.length) return;
    if (await onDeleteValues(vals)) {
      setMarked(new Set());
      setSelectMode(false);
    }
  }
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
    if (startsWithOther(newValue)) return window.alert(OTHER_VALUE_MSG);
    await onAddValue(newValue.trim());
    setNewValue("");
  }

  const isChoice = attr.input_type === "single" || attr.input_type === "multi";
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyLists, setCopyLists] = useState([]);
  const [copyFrom, setCopyFrom] = useState(null);
  const [copyMsg, setCopyMsg] = useState(null);

  function openCopy() {
    setCopyOpen(true);
    setCopyMsg(null);
    api.adminListAttributes().then(setCopyLists);
  }

  async function copyValues() {
    if (!copyFrom) return;
    const n = await onCopyValues(copyFrom);
    setCopyMsg(n ? `✓ נוספו ${n} תשובות` : "כל התשובות כבר קיימות ברשימה");
    setCopyFrom(null);
  }

  // drag answer tags to reorder them (saved on release)
  const { shown: shownValues, startDrag, dragId } = usePointerSort(attr.values, "values-" + attr.id, onReorderValues, () => !selectMode);
  const detailValue = attr.values.find((v) => v.id === detailValueId);

  async function saveValueText(v, text) {
    if (!text || text === v.value) return setEditingValueId(null);
    if (startsWithOther(text)) return window.alert(OTHER_VALUE_MSG);
    try {
      await onRenameValue(v, text);
      setEditingValueId(null);
    } catch (e) {
      window.alert(/כבר קיימת/.test(e.message) ? "תשובה בשם הזה כבר קיימת ברשימה." : "השמירה נכשלה, נסו שוב.");
    }
  }

  return (
    <div className={"q-card" + (dragging ? " dragging" : "")} {...sortProps}>
      <div className="q-card-top">
        <div className="q-card-name-wrap">
          {dragHandle}
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
          <TypePicker type={attr.input_type} max={attr.max_select} onChange={onSetType} />
        </div>
        <div className="q-card-actions">
          <label className={"req-toggle" + (attr.required ? " on" : "")}>
            <input type="checkbox" checked={!!attr.required} onChange={(e) => onSetRequired(e.target.checked)} />
            חובה
          </label>
          {isChoice && !isYesNoList(attr.values) && (
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
          <button className="btn btn-sm btn-soft" onClick={onDelete}>מחק שאלה</button>
        </div>
      </div>
      {isChoice && (
        <div className="q-card-body">
          <div className="chip-row">
            {shownValues.map((v) => (
              editingValueId === v.id ? (
                <InlineEdit key={v.id} initial={v.value} onSave={(t) => saveValueText(v, t)} onCancel={() => setEditingValueId(null)} />
              ) : (
                <span
                  className={"tag" + (selectMode ? " tag-select" : " tag-drag") + (dragId === v.id ? " dragging" : "") + (marked.has(v.id) ? " marked" : "")}
                  key={v.id}
                  data-sort-group={"values-" + attr.id}
                  data-sort-id={v.id}
                  onPointerDown={(e) => !selectMode && startDrag(e, v)}
                  onClick={() => selectMode && toggleMark(v.id)}
                >
                  {selectMode && <input type="checkbox" readOnly checked={marked.has(v.id)} style={{ width: "auto", margin: 0 }} />}
                  {v.value}
                  {v.detail_kind && <span title={"מבקש פירוט: " + (v.detail_prompt || "")}>📝</span>}
                  {!selectMode && (
                    <>
                      <button type="button" className="tag-x" title="שינוי הנוסח (התשובה נשארת אותה תשובה בהשוואות)" onClick={() => setEditingValueId(v.id)}>✎</button>
                      <button type="button" className="tag-x" title="פירוט: שדה נוסף שנפתח כשבוחרים בתשובה הזו" onClick={() => setDetailValueId(v.id)}>⋯</button>
                      <button type="button" className="tag-x" title="הסר תשובה זו" onClick={() => onDeleteValue(v)}>✕</button>
                    </>
                  )}
                </span>
              )
            ))}
            {!attr.values.length && <span className="muted">אין ערכים מוגדרים עדיין</span>}
          </div>
          {detailValue && (
            <DetailSettings
              key={detailValue.id}
              v={detailValue}
              onClose={() => setDetailValueId(null)}
              onSave={async (kind, prompt) => { await onSetValueDetail(detailValue, kind, prompt); setDetailValueId(null); }}
            />
          )}
          {attr.values.length > 1 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
              {!selectMode && <button className="btn btn-sm" onClick={() => setSelectMode(true)}>☑ בחירה מרובה למחיקה</button>}
              {selectMode && (
                <>
                  <button className="btn btn-sm btn-pr" onClick={deleteMarked} disabled={!marked.size}>מחק את המסומנות ({marked.size})</button>
                  <button className="btn btn-sm" onClick={() => setMarked(new Set(attr.values.map((v) => v.id)))}>סמן הכל</button>
                  <button className="btn btn-sm" onClick={() => { setSelectMode(false); setMarked(new Set()); }}>ביטול</button>
                  <span className="muted" style={{ fontSize: 12 }}>לחצו על התשובות שברצונכם למחוק</span>
                </>
              )}
            </div>
          )}
          {attr.values.length > 1 && (
            <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              ניתן לגרור תשובה כדי לשנות את הסדר (הימנית ביותר מוצגת ראשונה). ✎ משנה את הנוסח בלבד: דיווחים שכבר בחרו בתשובה יציגו את הנוסח החדש וימשיכו להיות מושווים אליה. ⋯ מגדיר שדה פירוט שנפתח כשבוחרים בתשובה (📝 = מוגדר).
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
          {!copyOpen && (
            <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={openCopy}>📋 העתק תשובות מרשימה אחרת</button>
          )}
          {copyOpen && (
            <div style={{ marginTop: 10, padding: 10, border: "1px dashed var(--border2)", borderRadius: "var(--r)" }}>
              <label>מאיזו רשימה להעתיק? (התשובות יתווספו לרשימה הזו, בלי כפילויות)</label>
              <ListPicker lists={copyLists} value={copyFrom} onChange={setCopyFrom} excludeId={attr.id} choiceOnly />
              <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                <button className="btn btn-sm btn-pr" onClick={copyValues} disabled={!copyFrom}>העתק</button>
                <button className="btn btn-sm" onClick={() => setCopyOpen(false)}>סגור</button>
                {copyMsg && <span style={{ color: "#15803d", fontWeight: 600, fontSize: 13 }}>{copyMsg}</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Add one question (a copy of an existing one, or brand-new) to many items at once: tick items,
// pick the question, submit. Every ticked item gets its own independent copy.
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
  const [itemsLoaded, setItemsLoaded] = useState(false); // the first load can take a while when the server wakes up
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

  function loadItems() { return api.adminListItems().then((r) => { setItems(r); setItemsLoaded(true); }); }
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

  async function setType(attrId, input_type, max_select, fromUniversal) {
    try {
      await api.adminSetAttributeType(attrId, input_type, max_select);
    } catch {
      return window.alert("שמירת הסוג נכשלה, נסו שוב.");
    }
    const patch = (a) => (a.id === attrId ? { ...a, input_type, max_select } : a);
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

  // remove several answers in one go (one confirmation); resolves true when done
  async function deleteValues(attr, values, fromUniversal) {
    if (!window.confirm(`האם את/ה בטוח/ה שברצונך להסיר ${values.length} תשובות מהשאלה "${attr.name}"?\n${values.map((v) => v.value).join(", ")}`)) return false;
    await api.adminDeleteValues(values.map((v) => v.id));
    const gone = new Set(values.map((v) => v.id));
    const patch = (a) => (a.id === attr.id ? { ...a, values: a.values.filter((v) => !gone.has(v.id)) } : a);
    if (fromUniversal) setUniversal((prev) => prev.map(patch));
    else setAttrs((prev) => prev.map(patch));
    return true;
  }

  async function setValueDetail(attrId, value, kind, prompt, fromUniversal) {
    await api.adminSetValueDetail(value.id, kind, prompt);
    const patch = (a) => (a.id === attrId
      ? { ...a, values: a.values.map((v) => (v.id === value.id ? { ...v, detail_kind: kind, detail_prompt: kind ? prompt : null } : v)) }
      : a);
    if (fromUniversal) setUniversal((prev) => prev.map(patch));
    else setAttrs((prev) => prev.map(patch));
  }

  async function hideItem() {
    if (!window.confirm(`למחוק את הפריט "${selectedItem.name}"?\nהפריט יוסתר מכל הרשימות. דיווחים קודמים עליו יישארו ויציגו אותו. אפשר להחזיר אותו בכל עת מתוך "פריטים מוסתרים".`)) return;
    await api.adminSetItemHidden(selectedItem.id, true);
    setSelectedItem(null);
    loadItems();
  }

  async function restoreItem(it) {
    await api.adminSetItemHidden(it.id, false);
    loadItems();
  }

  async function setUnits(multi_unit, max_units) {
    const updated = await api.adminSetItemFlags(selectedItem.id, { multi_unit, max_units });
    setSelectedItem((prev) => ({ ...prev, ...updated }));
    setItems((prev) => prev.map((it) => (it.id === selectedItem.id ? { ...it, ...updated } : it)));
  }

  // reword an answer in place — same id, so past reports and matching are unaffected
  async function renameValue(attrId, value, text, fromUniversal) {
    await api.adminRenameValue(value.id, text);
    const patch = (a) => (a.id === attrId ? { ...a, values: a.values.map((v) => (v.id === value.id ? { ...v, value: text } : v)) } : a);
    if (fromUniversal) setUniversal((prev) => prev.map(patch));
    else setAttrs((prev) => prev.map(patch));
  }

  // a value used by past reports is hidden (not deleted) server-side — either way it leaves the list
  async function deleteValue(attr, value, fromUniversal) {
    if (!window.confirm(`האם את/ה בטוח/ה שברצונך להסיר את התשובה "${value.value}" מהשאלה "${attr.name}"?`)) return;
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

  async function copyValuesInto(attrId, fromId, fromUniversal) {
    const r = await api.adminCopyValues(attrId, fromId);
    if (fromUniversal) loadUniversal();
    else setAttrs(await api.adminGetItemAttributes(selectedItem.id));
    return r.count;
  }

  async function removeItemAttribute(attr) {
    if (!window.confirm(`האם את/ה בטוח/ה שברצונך למחוק את השאלה "${attr.name}" מהפריט "${selectedItem.name}"?`)) return;
    await api.adminRemoveItemAttribute(selectedItem.id, attr.id);
    setAttrs((prev) => prev.filter((a) => a.id !== attr.id));
  }

  async function deleteAttributeEntirely(attrId, fromUniversal) {
    const attr = (fromUniversal ? universal : attrs).find((a) => a.id === attrId);
    if (!window.confirm(`האם את/ה בטוח/ה שברצונך למחוק את שאלת הבסיס "${attr?.name}"?\nהיא לא תופיע יותר בדיווחים, והתשובות שניתנו לה בדיווחים קיימים יימחקו.`)) return;
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

  const visibleItems = items.filter((it) => !it.is_hidden);
  const { shown: sortedQuestions, startDrag: startQuestionDrag, dragId: draggingQuestion } = usePointerSort(attrs, "questions", async (next) => {
    setAttrs(next);
    await api.adminReorderQuestions(selectedItem.id, next.map((a) => a.id));
  });
  const hiddenItems = items.filter((it) => it.is_hidden);
  const q = search.trim().toLowerCase();
  const filteredItems = q ? visibleItems.filter((it) => it.name.toLowerCase().includes(q)) : visibleItems;
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
          <div className="admin-panel-h">🗂️ פריטים ({visibleItems.length})</div>
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
              {!itemsLoaded && <div className="loading"><span className="spinner" /> טוען פריטים...</div>}
              {itemsLoaded && !Object.keys(grouped).length && <p className="muted" style={{ padding: 8 }}>לא נמצאו פריטים.</p>}
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
          {hiddenItems.length > 0 && (
            <div className="admin-section">
              <details>
                <summary className="muted" style={{ cursor: "pointer" }}>🙈 פריטים מוסתרים ({hiddenItems.length})</summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                  {hiddenItems.map((it) => (
                    <div key={it.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                      <span>{it.name} <span className="muted">({it.sub_name})</span></span>
                      <button className="btn btn-sm btn-soft" onClick={() => restoreItem(it)}>החזר</button>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
          <div className="admin-panel-h" style={{ borderTop: "1px solid var(--border)" }}>📋 שאלות בסיס (נשאלות בכל דיווח)</div>
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

        </div>

        <div style={{ minWidth: 0 }}>
          {bulkOpen && <BulkAddPanel items={visibleItems} onClose={() => setBulkOpen(false)} />}

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
                  onSetType={(t, m) => setType(selectedUniversal.id, t, m, true)}
                  onAddValue={(v) => addValue(selectedUniversal.id, v, true)}
                  onDeleteValue={(v) => deleteValue(selectedUniversal, v, true)}
                  onDeleteValues={(vals) => deleteValues(selectedUniversal, vals, true)}
                  onSetValueDetail={(v, k, p) => setValueDetail(selectedUniversal.id, v, k, p, true)}
                  onReorderValues={(values) => reorderValues(selectedUniversal.id, values, true)}
                  onRenameValue={(v, t) => renameValue(selectedUniversal.id, v, t, true)}
                  onCopyValues={(fromId) => copyValuesInto(selectedUniversal.id, fromId, true)}
                  onDelete={() => deleteAttributeEntirely(selectedUniversal.id, true)}
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
                <button className="btn btn-sm btn-soft" onClick={hideItem} title="הפריט יוסתר מכל הרשימות; דיווחים קודמים יישארו">🗑 מחק פריט</button>
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
                    <label className="flag-chip">
                      <input type="checkbox" checked={!!selectedItem.multi_unit} onChange={(e) => setUnits(e.target.checked, selectedItem.max_units || 5)} />
                      אפשר לדווח כמה יחידות, כל אחת עם תיאור משלה
                      {selectedItem.multi_unit && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} onClick={(e) => e.preventDefault()}>
                          (עד
                          <input
                            type="number"
                            min={2}
                            max={20}
                            value={selectedItem.max_units || 5}
                            onChange={(e) => setUnits(true, Number(e.target.value))}
                            style={{ width: 56, padding: "2px 4px" }}
                          />
                          )
                        </span>
                      )}
                    </label>
                  </div>
                </div>

                <ItemContainersEditor item={selectedItem} items={visibleItems} />

                <CopyQuestionsPanel item={selectedItem} items={visibleItems} onDone={() => api.adminGetItemAttributes(selectedItem.id).then(setAttrs)} />
                {!attrs.length && <p className="muted" style={{ marginBottom: 12 }}>לפריט זה אין שאלות מוגדרות.</p>}
                {attrs.length > 1 && <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>גררו את ⠿ כדי לשנות את סדר השאלות.</p>}
                {sortedQuestions.map((a) => (
                  <QuestionCard
                    key={a.id}
                    attr={a}
                    sortProps={{ "data-sort-group": "questions", "data-sort-id": a.id }}
                    dragging={draggingQuestion === a.id}
                    dragHandle={<span className="drag-handle" title="גרירה לשינוי הסדר" onPointerDown={(e) => startQuestionDrag(e, a)}>⠿</span>}
                    onDeleteValues={(vals) => deleteValues(a, vals, false)}
                    onSetValueDetail={(v, k, p) => setValueDetail(a.id, v, k, p, false)}
                    onRename={(name) => renameAttribute(a.id, name, false)}
                    onSetWeight={(w) => setWeight(a.id, w)}
                    onSetRequired={(r) => setRequired(a.id, r)}
                    onSetAllowOther={(on) => setAllowOther(a.id, on)}
                    onSetType={(t, m) => setType(a.id, t, m, false)}
                    onAddValue={(v) => addValue(a.id, v, false)}
                    onDeleteValue={(v) => deleteValue(a, v, false)}
                    onReorderValues={(values) => reorderValues(a.id, values, false)}
                    onRenameValue={(v, t) => renameValue(a.id, v, t, false)}
                    onCopyValues={(fromId) => copyValuesInto(a.id, fromId, false)}
                    onDelete={() => removeItemAttribute(a)}
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
