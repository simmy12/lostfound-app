import { createContext, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { formatAnswerValue } from "../format";
import { ISRAELI_CITIES } from "../cities";

const STEPS = ["פריט", "פרטים", "מיקום ותאריך", "סיכום"];
const MAX_LINKED = 4;
// "what was inside it?" — once the reporter answers yes, at least MIN_CONTENTS items are required
const MAX_CONTENTS = 5;
const MIN_CONTENTS = 2;
const VALUE_SEARCH_MIN = 12; // from this many answer options, offer a search box above them

// true once the reporter pressed "המשך" on a step that still has missing fields — from then on
// every unfilled "אחר" text box and unanswered required question on that step gets a red frame
const ShowErrors = createContext(false);

// the question type drives the answer widget: single/multi are choice lists (multi allows up to
// max_select picks), text/number are typed in — whatever values a text question may still carry
const isChoice = (attr) => (attr.input_type === "single" || attr.input_type === "multi") && attr.values?.length > 0;
const maxPicks = (attr) => (attr.input_type === "multi" ? attr.max_select || 2 : 1);

function attrLabel(attr) {
  if (isChoice(attr) && maxPicks(attr) > 1) return `${attr.name} (ניתן לבחור עד ${maxPicks(attr)})`;
  return attr.name;
}

// a plain yes/no gate (exactly "כן" and "לא") stays a strict single choice — picking both at
// once wouldn't mean anything, whatever the question type says.
function isYesNo(attr) {
  const vals = attr.values?.map((v) => v.value) || [];
  return vals.length === 2 && vals.includes("כן") && vals.includes("לא");
}

// Follow-up for an answer the admin marked "מבקש פירוט" (detail_kind). 'text' is a plain field;
// 'letters_or_text' first asks "letters or a name?" — letters gives one box per letter (up to 5) so it's clear exactly
// which letters were written, no gives a plain field. The detail object lives in value.details[valueId].
const MAX_LETTERS = 5;

function DetailField({ v, detail, onChange }) {
  const d = detail || {};
  if (v.detail_kind === "letters_or_text") {
    const letters = d.letters?.length ? d.letters : ["", "", ""];
    const setLetter = (i, ch) => onChange({ ...d, mode: "letters", letters: letters.map((x, j) => (j === i ? ch.slice(-1) : x)) });
    return (
      <div className="detail-box">
        <div className="q-label" style={{ marginBottom: 6 }}>{v.detail_prompt || "לפרט"} אותיות או שם?</div>
        <div className="opts" style={{ marginBottom: 8 }}>
          <button type="button" className={"opt-btn" + (d.mode === "letters" ? " sel" : "")} onClick={() => onChange({ ...d, mode: "letters", letters })}>רק אותיות</button>
          <button type="button" className={"opt-btn" + (d.mode === "text" ? " sel" : "")} onClick={() => onChange({ ...d, mode: "text" })}>שם</button>
        </div>
        {d.mode === "letters" && (
          <>
            <div className="letter-boxes">
              {letters.map((ch, i) => (
                <input
                  key={i}
                  type="text"
                  className="letter-box"
                  maxLength={2}
                  value={ch}
                  aria-label={`אות ${i + 1}`}
                  onChange={(e) => {
                    setLetter(i, e.target.value);
                    if (e.target.value) e.target.nextElementSibling?.focus();
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              {letters.length < MAX_LETTERS && <button type="button" className="btn btn-sm" onClick={() => onChange({ ...d, mode: "letters", letters: [...letters, ""] })}>+ אות</button>}
              {letters.length > 1 && <button type="button" className="btn btn-sm" onClick={() => onChange({ ...d, mode: "letters", letters: letters.slice(0, -1) })}>− אות</button>}
            </div>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>אות אחת בכל תיבה, לפי הסדר (עד 5 אותיות).</p>
          </>
        )}
        {d.mode === "text" && (
          <input type="text" placeholder="מה השם שכתוב?" value={d.text || ""} onChange={(e) => onChange({ ...d, mode: "text", text: e.target.value })} />
        )}
      </div>
    );
  }
  return (
    <div className="detail-box">
      <div className="q-label" style={{ marginBottom: 6 }}>{v.detail_prompt || `לפרט (${v.value})`}</div>
      <input type="text" placeholder="לפרט..." value={d.text || ""} onChange={(e) => onChange({ ...d, mode: "text", text: e.target.value })} />
    </div>
  );
}

// the text saved with an answer's follow-up ("" when nothing was filled in)
function detailText(d) {
  if (!d) return "";
  if (d.mode === "letters") {
    const letters = (d.letters || []).map((x) => x.trim()).filter(Boolean);
    return letters.length ? "אותיות: " + letters.join(" ") : "";
  }
  return (d.text || "").trim();
}

// value shapes stored in an `answers` map (attribute_id -> value):
//   choice:           { attribute_id, value_ids: [...] (max maxPicks), isOther?, free_text?, details?: {valueId: detail} }
//   strict yes/no:    { attribute_id, value_id? , isOther?, free_text? }
//   text/number/date: { attribute_id, free_text }
function AttributeField({ attr, value, onChange }) {
  const showErrors = useContext(ShowErrors);
  const [search, setSearch] = useState("");
  const otherCls = showErrors && !(value?.free_text || "").trim() ? "input-err" : undefined;
  // yes/no: exactly one of the two, never "אחר"
  if (isChoice(attr) && isYesNo(attr)) {
    return (
      <div>
        <div className="opts">
          {attr.values.map((v) => (
            <button
              key={v.id}
              type="button"
              className={"opt-btn" + (value?.value_id === v.id ? " sel" : "")}
              onClick={() => onChange({ attribute_id: attr.id, value_id: v.id })}
            >
              {v.value}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (isChoice(attr)) {
    const selected = value?.value_ids || [];
    const isOther = !!value?.isOther;
    const cap = maxPicks(attr);
    // single choice: a new pick replaces the old one; multi: picks stop at the cap
    const atCap = cap > 1 && selected.length + (isOther ? 1 : 0) >= cap;
    const searchable = attr.values.length >= VALUE_SEARCH_MIN;
    const q = search.trim();
    // already-picked answers stay visible while searching, so they can still be un-picked
    const shown = searchable && q ? attr.values.filter((v) => v.value.includes(q) || selected.includes(v.id)) : attr.values;
    return (
      <div>
        {searchable && (
          <input type="text" className="opt-search" placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        {searchable && q && !shown.length && <p className="muted" style={{ margin: "4px 0" }}>לא נמצאו תשובות מתאימות.</p>}
        <div className="opts">
          {shown.map((v) => {
            const isSel = selected.includes(v.id);
            const disabled = !isSel && atCap;
            return (
              <button
                key={v.id}
                type="button"
                disabled={disabled}
                className={"opt-btn" + (isSel ? " sel" : "")}
                onClick={() => {
                  if (cap === 1) return onChange({ attribute_id: attr.id, value_ids: isSel ? [] : [v.id], details: value?.details });
                  const next = isSel ? selected.filter((id) => id !== v.id) : [...selected, v.id];
                  onChange({ attribute_id: attr.id, value_ids: next, isOther, free_text: value?.free_text, details: value?.details });
                }}
              >
                {v.value}
              </button>
            );
          })}
          {attr.allow_other !== false && (
            <button
              type="button"
              disabled={!isOther && atCap}
              className={"opt-btn" + (isOther ? " sel" : "")}
              onClick={() => onChange({ attribute_id: attr.id, value_ids: cap === 1 ? [] : selected, isOther: !isOther, free_text: value?.free_text, details: value?.details })}
            >
              אחר
            </button>
          )}
        </div>
        {attr.values.filter((v) => v.detail_kind && selected.includes(v.id)).map((v) => (
          <DetailField
            key={v.id}
            v={v}
            detail={value?.details?.[v.id]}
            onChange={(d) => onChange({ ...value, attribute_id: attr.id, value_ids: selected, details: { ...(value?.details || {}), [v.id]: d } })}
          />
        ))}
        {isOther && (
          <input
            type="text"
            className={otherCls}
            placeholder="לפרט..."
            value={value?.free_text || ""}
            onChange={(e) => onChange({ attribute_id: attr.id, value_ids: selected, isOther: true, free_text: e.target.value, details: value?.details })}
          />
        )}
      </div>
    );
  }
  if (attr.input_type === "number") {
    return (
      <input
        type="number"
        value={value?.free_text || ""}
        onChange={(e) => onChange({ attribute_id: attr.id, free_text: e.target.value })}
      />
    );
  }
  if (attr.name.includes("תאריך")) {
    return (
      <input
        type="date"
        value={value?.free_text || ""}
        onChange={(e) => onChange({ attribute_id: attr.id, free_text: e.target.value })}
      />
    );
  }
  if (attr.name === "עיר") {
    return (
      <input
        type="text"
        list="cities-datalist"
        value={value?.free_text || ""}
        onChange={(e) => onChange({ attribute_id: attr.id, free_text: e.target.value })}
        placeholder="התחל/י להקליד שם עיר/יישוב..."
      />
    );
  }
  return (
    <input
      type="text"
      value={value?.free_text || ""}
      onChange={(e) => onChange({ attribute_id: attr.id, free_text: e.target.value })}
    />
  );
}

// flattens the {attribute_id: value} map into the flat [{attribute_id, value_id|free_text}] array
// the backend expects — one row per selected value for multi-select attributes.
function flattenAnswers(answers) {
  const out = [];
  for (const a of Object.values(answers)) {
    if (!a) continue;
    if (a.value_ids) {
      for (const vid of a.value_ids) out.push({ attribute_id: a.attribute_id, value_id: vid, free_text: detailText(a.details?.[vid]) || undefined });
      if (a.isOther && a.free_text) out.push({ attribute_id: a.attribute_id, free_text: a.free_text });
    } else if (a.isOther) {
      if (a.free_text) out.push({ attribute_id: a.attribute_id, free_text: a.free_text });
    } else if (a.value_id != null) {
      out.push({ attribute_id: a.attribute_id, value_id: a.value_id });
    } else if (a.free_text) {
      out.push({ attribute_id: a.attribute_id, free_text: a.free_text });
    }
  }
  return out;
}

// Israeli phone number: mobile/07x numbers have 10 digits, landlines (02/03/04/08/09) have 9.
// Spaces, dashes and a +972 prefix are accepted. Empty counts as valid (the field is optional).
function isValidPhone(text) {
  const digits = (text || "").replace(/[\s\-()]/g, "").replace(/^\+972/, "0");
  if (!digits) return true;
  if (/^0[57]\d{8}$/.test(digits)) return true;
  return /^0[23489]\d{7}$/.test(digits);
}

// "אחר" is only a real answer once free text backs it up — used to gate the "המשך" buttons so a
// half-picked "אחר" (chosen but not typed) can't silently vanish (flattenAnswers would just drop it).
function isOtherIncomplete(v) {
  return !!v?.isOther && !(v?.free_text || "").trim();
}

// whether `value` counts as a real answer to `attr` — used to enforce admin-marked required questions
function isAnswered(attr, value) {
  if (!value) return false;
  if (isChoice(attr)) {
    if (value.value_id != null) return true; // strict yes/no gate
    if (value.value_ids?.length) return true; // choice, up to 2
    return !!value.isOther && !!(value.free_text || "").trim();
  }
  return !!(value.free_text || "").trim();
}

// a question block; framed red when the step was submitted while this required question is unanswered
function QuestionBlock({ attr, answered, children }) {
  const showErrors = useContext(ShowErrors);
  const missing = showErrors && attr.required && !answered;
  return (
    <div className={"q-block" + (missing ? " q-err" : "")}>
      {children}
      {missing && <div className="q-err-msg">שדה חובה</div>}
    </div>
  );
}

// Lets the reporter find an item either by browsing category -> sub-category -> item, or by
// typing a free-text search across the whole catalog — one method at a time, toggled by a tab bar.
// Reports the chosen item ({id, name}) up via onSelect; null when nothing is chosen (yet).
function ItemPicker({ categories, searchLabel = "איזה פריט?", onSelect, selectedItemId }) {
  const [mode, setMode] = useState("search"); // search first — it's the fastest path for most people
  const [mainId, setMainId] = useState(null);
  const [subId, setSubId] = useState(null);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false); // true while the debounce/fetch for the current query is still in flight

  const main = categories.find((m) => m.id === mainId);
  const subs = main?.subs || [];

  // skip a step when it has only one possible choice — there's nothing to actually pick
  useEffect(() => {
    if (subs.length === 1 && subId !== subs[0].id) setSubId(subs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainId, subs.length]);

  useEffect(() => {
    if (subId) api.getItems(subId).then(setItems);
    else setItems([]);
  }, [subId]);

  useEffect(() => {
    if (items.length === 1) onSelect(items[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // "אין תוצאות" must only show once a search for the CURRENT query has actually come back empty —
  // not while the debounce/fetch is still pending, and not with a stale result from a query that's
  // since changed.
  useEffect(() => {
    const q = query.trim();
    if (mode !== "search" || !q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      api.searchItems(q).then((res) => {
        if (cancelled) return;
        setSearchResults(res);
        setSearching(false);
      });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, mode]);

  function switchMode(next) {
    if (next === mode) return;
    setMode(next);
    setMainId(null);
    setSubId(null);
    setQuery("");
    setSearchResults([]);
    setSearching(false);
    onSelect(null);
  }

  return (
    <>
      {mode === "category" && (
        <>
          <p className="info-note">
            <a href="#" onClick={(e) => { e.preventDefault(); switchMode("search"); }}>→ חזרה לחיפוש</a>
          </p>
          <div className="q-block">
            <label>קטגוריה ראשית</label>
            <select value={mainId || ""} onChange={(e) => { setMainId(Number(e.target.value) || null); setSubId(null); onSelect(null); }}>
              <option value="">— בחר קטגוריה —</option>
              {categories.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {mainId && subs.length > 1 && (
            <div className="q-block">
              <label>תת-קטגוריה</label>
              <select value={subId || ""} onChange={(e) => { setSubId(Number(e.target.value) || null); onSelect(null); }}>
                <option value="">— בחר תת-קטגוריה —</option>
                {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {subId && items.length > 1 && (
            <div className="q-block">
              <label>פריט</label>
              <select
                value={selectedItemId || ""}
                onChange={(e) => onSelect(items.find((it) => it.id === Number(e.target.value)) || null)}
              >
                <option value="">— בחר פריט —</option>
                {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select>
            </div>
          )}
        </>
      )}

      {mode === "search" && (
        <div className="q-block">
          <label>{searchLabel}</label>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="למשל: מעיל, ארנק, משקפיים..." autoFocus />
          {query.trim() && searching && <div className="loading"><span className="spinner" /> מחפש...</div>}
          {searchResults.length > 0 && (
            <div className="opts">
              {searchResults.map((it) => (
                <button
                  type="button"
                  key={it.id}
                  className={"opt-btn" + (selectedItemId === it.id ? " sel" : "")}
                  onClick={() => onSelect(it)}
                >
                  {it.name}
                </button>
              ))}
            </div>
          )}
          {query.trim() && !searching && !searchResults.length && (
            <p className="muted">
              אין תוצאות. <a href="#" onClick={(e) => { e.preventDefault(); switchMode("category"); }}>בחר/י לפי קטגוריה</a>
            </p>
          )}
        </div>
      )}
    </>
  );
}

// The "was this inside something?" options for the reported item — that item's own list, set by
// the admin per item. When the admin hasn't set a list for it, the regular catalog search is offered.
function ContainerPicker({ forItemId, categories, onSelect, selectedItemId }) {
  const [options, setOptions] = useState(null);
  useEffect(() => {
    if (forItemId) api.getItemContainers(forItemId).then(setOptions);
  }, [forItemId]);
  if (options === null) return null;
  if (!options.length) return <ItemPicker categories={categories} selectedItemId={selectedItemId} onSelect={onSelect} />;
  return (
    <div className="q-block">
      <label>בחר/י מהרשימה</label>
      <div className="opts">
        {options.map((it) => (
          <button
            type="button"
            key={it.id}
            className={"opt-btn" + (selectedItemId === it.id ? " sel" : "")}
            onClick={() => onSelect(it)}
          >
            {it.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// A self-contained item picker + attributes card, used for container / contents / nearby items.
// Reports its current {item_id, item_answers} up to the parent on every change.
// containerMode: when set (the "was this inside something?" flow), the reporter picks from the
// reported item's own ContainerPicker list (containerFor) instead of the full ItemPicker.
// allowNestedContents: when set (also only the "was this inside something?" flow), and the chosen
// container item can itself contain things, offer adding up to 3 more items found in that same
// container (the original item already takes up one of its 4 slots).
function SubReportPicker({ categories, label, onChange, onRemove, containerMode, containerFor, allowNestedContents, originalItemName }) {
  const [item, setItem] = useState(null); // {id, name}
  const [itemMeta, setItemMeta] = useState(null);
  const [itemAttrs, setItemAttrs] = useState([]);
  const [answers, setAnswers] = useState({});
  const [nestedContents, setNestedContents] = useState([]);

  useEffect(() => {
    if (item) {
      api.getItemAttributes(item.id).then(setItemAttrs);
      if (allowNestedContents) api.getItem(item.id).then(setItemMeta);
    } else {
      setItemAttrs([]);
      setItemMeta(null);
    }
    setAnswers({});
    setNestedContents([]);
  }, [item?.id]);

  useEffect(() => {
    onChange(
      item
        ? {
            item_id: item.id,
            item_name: item.name,
            item_answers: flattenAnswers(answers),
            contents: nestedContents.filter((c) => c.value).map((c) => c.value),
            incomplete: Object.values(answers).some(isOtherIncomplete) || nestedContents.some((c) => c.value?.incomplete),
          }
        : null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, answers, nestedContents]);

  return (
    <div className="card" style={{ marginTop: 10, background: "#f8fafc" }}>
      <div className="card-b">
        <div className="form-actions" style={{ marginBottom: 8 }}>
          <span className="muted">{label}</span>
          {onRemove && <button type="button" className="btn btn-sm" onClick={onRemove}>✕ הסר</button>}
        </div>

        {containerMode ? (
          <ContainerPicker forItemId={containerFor} categories={categories} selectedItemId={item?.id} onSelect={setItem} />
        ) : (
          <ItemPicker categories={categories} selectedItemId={item?.id} onSelect={setItem} />
        )}

        {item && containerMode && (
          <p className="attrs-intro">התכונות הבאות מתארות את ה{item.name}:</p>
        )}
        {item && itemAttrs.map((attr, i) => (
          <div className="q-block" key={attr.id}>
            <div className="q-label"><span className="q-num">{i + 1}</span>{attrLabel(attr)}</div>
            <AttributeField attr={attr} value={answers[attr.id]} onChange={(a) => setAnswers((p) => ({ ...p, [attr.id]: a }))} />
          </div>
        ))}
        {item && !itemAttrs.length && <p className="muted">לפריט זה אין שאלות נוספות.</p>}

        {allowNestedContents && itemMeta?.can_contain_items && (
          <div style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: 10, marginTop: 10 }}>
            <div className="q-block">
              <div className="q-label">תכולת ה{itemMeta.name || item.name}:</div>
              <div className="nested-orig">1. {originalItemName} (הפריט המקורי)</div>
            </div>
            <LinkedItemsList
              title="פריט"
              prompt={`האם היו עוד דברים בתוך ה${itemMeta.name || "פריט"}?`}
              hint="ניתן להוסיף עד 3 פריטים נוספים שהיו יחד עם הפריט המקורי."
              items={nestedContents}
              setItems={setNestedContents}
              categories={categories}
              maxItems={MAX_LINKED - 1}
              startNumber={2}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function LinkedItemsList({ title, prompt, hint, items, setItems, categories, containerMode, containerFor, allowNestedContents, originalItemName, maxItems = MAX_LINKED, minItems = 0, startNumber = 1 }) {
  const [asking, setAsking] = useState(items.length > 0 ? true : null);

  // on "yes", open the pickers straight away — one for a single-item list (e.g. the container),
  // or as many as the list requires (minItems), so there's no extra "+ add" click
  function answerYes() {
    setAsking(true);
    const open = Math.max(minItems, maxItems === 1 ? 1 : 0);
    if (items.length < open) {
      setItems((prev) => [...prev, ...Array.from({ length: open - prev.length }, () => ({ key: Date.now() + Math.random(), value: null }))]);
    }
  }

  return (
    <div className="q-block">
      <div className="q-label">{prompt}</div>
      {asking == null && (
        <div className="opts">
          <button type="button" className="opt-btn" onClick={answerYes}>כן</button>
          <button type="button" className="opt-btn" onClick={() => { setAsking(false); setItems([]); }}>לא</button>
        </div>
      )}
      {asking === false && (
        <div className="opts">
          <button type="button" className="opt-btn sel" onClick={() => setAsking(null)}>לא</button>
          <button type="button" className="opt-btn" onClick={answerYes}>כן</button>
        </div>
      )}
      {asking === true && (
        <>
          <div className="opts" style={{ marginBottom: 6 }}>
            <button type="button" className="opt-btn sel" onClick={() => { setAsking(false); setItems([]); }}>כן</button>
          </div>
          {hint && <p className="muted" style={{ marginTop: 0 }}>{hint}</p>}
          {items.map((it, i) => (
            <SubReportPicker
              key={it.key}
              categories={categories}
              label={maxItems === 1 ? title : `${title} ${startNumber + i}`}
              containerMode={containerMode}
              containerFor={containerFor}
              allowNestedContents={allowNestedContents}
              originalItemName={originalItemName}
              onChange={(val) => setItems((prev) => prev.map((x, idx) => (idx === i ? { ...x, value: val } : x)))}
              onRemove={maxItems === 1 || items.length <= minItems ? undefined : () => setItems((prev) => prev.filter((_, idx) => idx !== i))}
            />
          ))}
          {items.length < maxItems && (
            <button
              type="button"
              className="btn btn-sm"
              style={{ marginTop: 8 }}
              onClick={() => setItems((prev) => [...prev, { key: Date.now() + Math.random(), value: null }])}
            >
              + הוסף פריט ({items.length}/{maxItems})
            </button>
          )}
        </>
      )}
    </div>
  );
}

// repMode: a rep filling the form for someone who phoned in — after sending, she lands on her
// search/matches screen with this report selected instead of the "sent" confirmation
export default function CitizenWizard({ repMode = false }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [type, setType] = useState("lost");
  const [categories, setCategories] = useState([]);
  const [item, setItem] = useState(null); // {id, name}
  const [itemMeta, setItemMeta] = useState(null); // { can_be_contained, can_have_nearby, can_contain_items, is_other_placeholder }
  const [itemAttrs, setItemAttrs] = useState([]);
  const [universalAttrs, setUniversalAttrs] = useState([]);
  const [answers, setAnswers] = useState({}); // attribute_id -> value (item + universal together)
  const [otherItemText, setOtherItemText] = useState(""); // mandatory when itemMeta.is_other_placeholder
  const [freeText, setFreeText] = useState(""); // "תיאור נוסף/הערה" — one combined field
  const [contact, setContact] = useState({ contact_name: "", contact_phone: "", contact_phone2: "", contact_email: "" });
  const [submitted, setSubmitted] = useState(null);
  const [showErrors, setShowErrors] = useState(false);

  const [unitCount, setUnitCount] = useState(1); // multi-unit items: how many were lost/found together
  const [unitAnswers, setUnitAnswers] = useState([]); // answers maps for units 2..unitCount (unit 1 uses `answers`)
  const [contents, setContents] = useState([]); // "what was inside" — SubReportPicker entries
  const [containerItems, setContainerItems] = useState([]); // "was it inside something" — max 1
  const [nearbyItems, setNearbyItems] = useState([]); // "items found nearby"

  useEffect(() => { api.getCategories().then(setCategories); }, []);
  useEffect(() => { api.getUniversalAttributes().then(setUniversalAttrs); }, []);
  useEffect(() => {
    if (item) {
      api.getItemAttributes(item.id).then(setItemAttrs);
      api.getItem(item.id).then(setItemMeta);
    } else {
      setItemAttrs([]);
      setItemMeta(null);
    }
    setContents([]);
    setUnitCount(1);
    setUnitAnswers([]);
    setContainerItems([]);
    setNearbyItems([]);
    setOtherItemText("");
  }, [item?.id]);

  const setAnswer = (a) => setAnswers((prev) => ({ ...prev, [a.attribute_id]: a }));
  const itemName = item?.name || "הפריט";

  // answered "yes" to "what was inside?" (so pickers are open) but fewer than MIN_CONTENTS items chosen
  const contentsTooFew = contents.length > 0 && contents.filter((c) => c.value).length < MIN_CONTENTS;
  // blocks "המשך": an "אחר" picked but not typed in, or an admin-marked-required question left unanswered
  const multiUnit = !!itemMeta?.multi_unit && !!itemMeta.units_prompt && unitCount > 1;
  const extraUnits = multiUnit ? Array.from({ length: unitCount - 1 }, (_, i) => unitAnswers[i] || {}) : [];
  const unitIncomplete = (ans) => itemAttrs.some((a) => isOtherIncomplete(ans[a.id]) || (a.required && !isAnswered(a, ans[a.id])));
  const step1Incomplete =
    unitIncomplete(answers) ||
    extraUnits.some(unitIncomplete) ||
    contentsTooFew ||
    contents.some((c) => c.value?.incomplete) ||
    containerItems.some((c) => c.value?.incomplete) ||
    nearbyItems.some((n) => n.value?.incomplete);
  const step2Incomplete = universalAttrs.some((a) => isOtherIncomplete(answers[a.id]) || (a.required && !isAnswered(a, answers[a.id])));

  function goTo(next) {
    setShowErrors(false);
    setStep(next);
  }

  // advance only when the current step is complete; otherwise frame the missing fields in red
  function tryNext(incomplete, next) {
    if (!incomplete) return goTo(next);
    setShowErrors(true);
    setTimeout(() => document.querySelector(".q-err, .input-err, .err-text")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }

  async function submit() {
    const itemAttrIds = new Set(itemAttrs.map((a) => a.id));
    const universalAttrIds = new Set(universalAttrs.map((a) => a.id));
    const pick = (ids) => Object.fromEntries(Object.entries(answers).filter(([k]) => ids.has(Number(k))));

    const payload = {
      type,
      item_id: item.id,
      free_text: freeText,
      other_item_text: itemMeta?.is_other_placeholder ? otherItemText.trim() : null,
      ...contact,
      item_answers: flattenAnswers(pick(itemAttrIds)),
      units: extraUnits.map(flattenAnswers),
      universal_answers: flattenAnswers(pick(universalAttrIds)),
      contents: contents.filter((c) => c.value).map((c) => c.value),
      container: containerItems[0]?.value || null,
      nearby: nearbyItems.filter((n) => n.value).map((n) => n.value),
    };
    const r = await api.createReport(payload);
    if (repMode) return navigate(`/rep?report=${r.id}&type=${type}`);
    setSubmitted(r.id);
  }

  if (submitted) {
    return (
      <div className="page page-center">
        <div className="card">
          <div className="card-h">הדיווח נשלח בהצלחה</div>
          <div className="card-b">
            <p>מספר דיווח: <b>#{submitted}</b></p>
            <p className="info-note">נציגינו יטפלו בפנייה בהקדם. עדכון יישלח לפרטי ההתקשרות שסיפקת.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ShowErrors.Provider value={showErrors}>
    <div className="page page-center">
      {repMode && (
        <div className="rep-banner">
          <span>📞 דיווח טלפוני — הנציגה ממלאת את הטופס עבור המתקשר/ת</span>
          <button className="btn btn-sm" onClick={() => navigate("/rep")}>→ חזרה למסך הנציגה</button>
        </div>
      )}
      <datalist id="cities-datalist">
        {ISRAELI_CITIES.map((c) => <option key={c} value={c} />)}
      </datalist>
      <div className="progress-wrap">
        {STEPS.map((s, i) => (
          <div className="step-label" key={s}>
            <div className={"step-dot" + (i < step ? " done" : i === step ? " act" : "")}>
              {i < step ? "✓" : i + 1}
            </div>
            <span>{s}</span>
          </div>
        ))}
      </div>

      <div className="card" style={{ display: step === 0 ? undefined : "none" }}>
          <div className="card-b">
            <div className="type-card-row">
              <div className={"type-card" + (type === "lost" ? " act" : "")} onClick={() => setType("lost")}>
                <div className="type-icon">🔍</div>
                <div className="type-title">אבידה</div>
              </div>
              <div className={"type-card" + (type === "found" ? " act" : "")} onClick={() => setType("found")}>
                <div className="type-icon">📦</div>
                <div className="type-title">מציאה</div>
              </div>
            </div>

            <ItemPicker categories={categories} searchLabel={type === "lost" ? "מה איבדתי" : "מה מצאתי"} selectedItemId={item?.id} onSelect={setItem} />

            {itemMeta?.is_other_placeholder && (
              <div className="q-block">
                <label>מה בעצם {type === "lost" ? "איבדת" : "מצאת"}? (שדה חובה)</label>
                <input
                  type="text"
                  className={showErrors && !otherItemText.trim() ? "input-err" : undefined}
                  value={otherItemText}
                  onChange={(e) => setOtherItemText(e.target.value)}
                  placeholder="לפרט מה הפריט..."
                />
              </div>
            )}

            <div className="form-actions">
              <span />
              <button
                className="btn btn-pr btn-lg"
                disabled={!item}
                onClick={() => tryNext(itemMeta?.is_other_placeholder && !otherItemText.trim(), 1)}
              >
                המשך ←
              </button>
            </div>
          </div>
      </div>

      <div className="card" style={{ display: step === 1 ? undefined : "none" }}>
          <div className="card-h">פרטי הפריט</div>
          <div className="card-b">
            {itemMeta?.multi_unit && itemMeta.units_prompt && (
              <div className="q-block">
                <div className="q-label">{itemMeta.units_prompt}</div>
                <div className="opts">
                  {Array.from({ length: itemMeta.max_units || 5 }, (_, i) => i + 1).map((n) => (
                    <button key={n} type="button" className={"opt-btn" + (unitCount === n ? " sel" : "")} onClick={() => setUnitCount(n)}>
                      {n}
                    </button>
                  ))}
                </div>
                {unitCount > 1 && <p className="muted" style={{ margin: "6px 0 0" }}>יש לתאר כל {itemName} בנפרד. כל אחת תקבל התאמות משלה.</p>}
              </div>
            )}
            {itemAttrs.length === 0 && <p className="muted">לפריט זה אין שאלות נוספות.</p>}
            {[answers, ...extraUnits].map((unitAns, u) => (
              <div key={u} className={multiUnit ? "unit-block" : undefined}>
                {multiUnit && <div className="unit-title">{itemName} {u + 1}</div>}
                {itemAttrs.map((attr, i) => (
                  <QuestionBlock key={attr.id} attr={attr} answered={isAnswered(attr, unitAns[attr.id])}>
                    <div className="q-label"><span className="q-num">{i + 1}</span>{attrLabel(attr)}{attr.required && <span style={{ color: "#b91c1c" }}> *</span>}</div>
                    <AttributeField
                      attr={attr}
                      value={unitAns[attr.id]}
                      onChange={
                        u === 0
                          ? setAnswer
                          : (a) => setUnitAnswers((prev) => {
                              const next = [...prev];
                              next[u - 1] = { ...(next[u - 1] || {}), [a.attribute_id]: a };
                              return next;
                            })
                      }
                    />
                  </QuestionBlock>
                ))}
              </div>
            ))}

            {itemMeta?.can_contain_items && (
              <LinkedItemsList
                title="פריט"
                prompt={`האם היו דברים בתוך ה${itemName}?`}
                hint={`יש להזין לפחות ${MIN_CONTENTS} פריטים (ניתן עד ${MAX_CONTENTS})`}
                maxItems={MAX_CONTENTS}
                minItems={MIN_CONTENTS}
                items={contents}
                setItems={setContents}
                categories={categories}
              />
            )}

            {itemMeta?.can_be_contained && (
              <LinkedItemsList
                title="בתוך מה היה?"
                prompt={`האם ה${itemName} היה בתוך משהו (תיק, מזוודה וכד')?`}
                containerMode
                containerFor={item?.id}
                allowNestedContents
                originalItemName={itemName}
                maxItems={1}
                items={containerItems}
                setItems={(fnOrVal) => setContainerItems((prev) => {
                  const next = typeof fnOrVal === "function" ? fnOrVal(prev) : fnOrVal;
                  return next.slice(0, 1); // at most one container
                })}
                categories={categories}
              />
            )}

            {itemMeta?.can_have_nearby && (
              <LinkedItemsList
                title="פריט סמוך"
                prompt={`האם היו פריטים נוספים ליד ה${containerItems[0]?.value?.item_name || itemName} שנראים ששייכים לאותו אדם?`}
                items={nearbyItems}
                setItems={setNearbyItems}
                categories={categories}
              />
            )}

            <div className="q-block">
              <label>תיאור נוסף/הערה</label>
              <textarea value={freeText} onChange={(e) => setFreeText(e.target.value)} placeholder="פרטים נוספים שיכולים לעזור לזהות את הפריט..." />
            </div>
            {showErrors && contentsTooFew && <p className="err-text">יש להזין לפחות {MIN_CONTENTS} פריטים שהיו בתוך ה{itemName}.</p>}
            <div className="form-actions">
              <button className="btn" onClick={() => goTo(0)}>→ חזרה</button>
              <button className="btn btn-pr btn-lg" onClick={() => tryNext(step1Incomplete, 2)}>המשך ←</button>
            </div>
          </div>
      </div>

      <div className="card" style={{ display: step === 2 ? undefined : "none" }}>
          <div className="card-h">מיקום ותאריך</div>
          <div className="card-b">
            {universalAttrs.map((attr, i) => (
              <QuestionBlock key={attr.id} attr={attr} answered={isAnswered(attr, answers[attr.id])}>
                <div className="q-label"><span className="q-num">{i + 1}</span>{attr.name}{attr.required && <span style={{ color: "#b91c1c" }}> *</span>}</div>
                <AttributeField attr={attr} value={answers[attr.id]} onChange={setAnswer} />
              </QuestionBlock>
            ))}
            <div className="form-actions">
              <button className="btn" onClick={() => goTo(1)}>→ חזרה</button>
              <button className="btn btn-pr btn-lg" onClick={() => tryNext(step2Incomplete, 3)}>המשך ←</button>
            </div>
          </div>
      </div>

      <div style={{ display: step === 3 ? undefined : "none" }}>
          <div className="card">
            <div className="card-h">סיכום הדיווח</div>
            <div className="card-b">
              <div className="sum-row"><span className="sum-k">סוג</span><span>{type === "lost" ? "אבדה" : "מציאה"}</span></div>
              {multiUnit && <div className="sum-row"><span className="sum-k">כמות</span><span>{unitCount} (כל אחת תדווח בנפרד)</span></div>}
              {itemAttrs.map((attr) => answers[attr.id] && (
                <div className="sum-row" key={attr.id}>
                  <span className="sum-k">{attr.name}</span>
                  <span>
                    {answers[attr.id].isOther
                      ? answers[attr.id].free_text
                      : answers[attr.id].value_ids
                        ? attr.values
                            .filter((v) => answers[attr.id].value_ids.includes(v.id))
                            .map((v) => (detailText(answers[attr.id].details?.[v.id]) ? `${v.value} (${detailText(answers[attr.id].details[v.id])})` : v.value))
                            .join(", ")
                        : attr.values?.find((v) => v.id === answers[attr.id].value_id)?.value || formatAnswerValue(attr.name, answers[attr.id].free_text)}
                  </span>
                </div>
              ))}
              {universalAttrs.map((attr) => answers[attr.id] && (
                <div className="sum-row" key={attr.id}>
                  <span className="sum-k">{attr.name}</span>
                  <span>{attr.values?.find((v) => v.id === answers[attr.id].value_id)?.value || formatAnswerValue(attr.name, answers[attr.id].free_text)}</span>
                </div>
              ))}
              {freeText && <div className="sum-row"><span className="sum-k">תיאור נוסף/הערה</span><span>{freeText}</span></div>}
              {contents.filter((c) => c.value).length > 0 && (
                <div className="sum-row"><span className="sum-k">תכולה שדווחה בנפרד</span><span>{contents.length} פריטים</span></div>
              )}
              {containerItems[0]?.value && (
                <div className="sum-row"><span className="sum-k">היה בתוך</span><span>דווח בנפרד</span></div>
              )}
              {nearbyItems.filter((n) => n.value).length > 0 && (
                <div className="sum-row"><span className="sum-k">פריטים סמוכים שדווחו</span><span>{nearbyItems.length} פריטים</span></div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-h">פרטי קשר</div>
            <div className="card-b">
              <label>שם מלא</label>
              <input type="text" value={contact.contact_name} onChange={(e) => setContact({ ...contact, contact_name: e.target.value })} />
              <div className="row" style={{ marginTop: 10 }}>
                {[["contact_phone", "טלפון"], ["contact_phone2", "טלפון נוסף"]].map(([key, label]) => {
                  const bad = showErrors && !isValidPhone(contact[key]);
                  return (
                    <div className="col" key={key}>
                      <label>{label}</label>
                      <input
                        type="tel"
                        dir="ltr"
                        inputMode="tel"
                        placeholder="050-1234567"
                        className={bad ? "input-err" : undefined}
                        value={contact[key]}
                        onChange={(e) => setContact({ ...contact, [key]: e.target.value })}
                      />
                      {bad && <div className="q-err-msg">מספר טלפון לא תקין</div>}
                    </div>
                  );
                })}
              </div>
              <label>אימייל</label>
              <input type="email" value={contact.contact_email} onChange={(e) => setContact({ ...contact, contact_email: e.target.value })} />
            </div>
          </div>

          <div className="form-actions">
            <button className="btn" onClick={() => goTo(2)}>→ חזרה</button>
            <button
              className="btn btn-pr btn-lg"
              disabled={step1Incomplete || step2Incomplete || (itemMeta?.is_other_placeholder && !otherItemText.trim())}
              onClick={() => {
                if (isValidPhone(contact.contact_phone) && isValidPhone(contact.contact_phone2)) return submit();
                setShowErrors(true);
                setTimeout(() => document.querySelector(".input-err")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
              }}
            >
              ✓ שלח דיווח
            </button>
          </div>
      </div>
    </div>
    </ShowErrors.Provider>
  );
}
