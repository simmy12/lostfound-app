import { useEffect, useState } from "react";
import { api } from "../api";
import { formatAnswerValue } from "../format";

const STEPS = ["פריט", "פרטים", "מיקום ותאריך", "סיכום"];
const MAX_LINKED = 4;
const MULTI_SELECT_CAP = 2;

function attrLabel(attr) {
  if (attr.name === "צבע") return "צבע עיקרי (עד 2 צבעים לבחירה)";
  return attr.name;
}

// value shapes stored in an `answers` map (attribute_id -> value):
//   single: { attribute_id, value_id? , isOther?, free_text? }
//   multi:  { attribute_id, value_ids: [...] (max 2), isOther?, free_text? }
//   text/number/date: { attribute_id, free_text }
function AttributeField({ attr, value, onChange }) {
  if (attr.input_type === "multi" && attr.values?.length) {
    const selected = value?.value_ids || [];
    const isOther = !!value?.isOther;
    const atCap = selected.length + (isOther ? 1 : 0) >= MULTI_SELECT_CAP;
    return (
      <div>
        <div className="opts">
          {attr.values.map((v) => {
            const isSel = selected.includes(v.id);
            const disabled = !isSel && atCap;
            return (
              <button
                key={v.id}
                type="button"
                disabled={disabled}
                className={"opt-btn" + (isSel ? " sel" : "")}
                onClick={() => {
                  const next = isSel ? selected.filter((id) => id !== v.id) : [...selected, v.id];
                  onChange({ attribute_id: attr.id, value_ids: next, isOther, free_text: value?.free_text });
                }}
              >
                {v.value}
              </button>
            );
          })}
          <button
            type="button"
            disabled={!isOther && atCap}
            className={"opt-btn" + (isOther ? " sel" : "")}
            onClick={() => onChange({ attribute_id: attr.id, value_ids: selected, isOther: !isOther, free_text: value?.free_text })}
          >
            אחר
          </button>
        </div>
        {isOther && (
          <input
            type="text"
            placeholder="פרט/י..."
            value={value?.free_text || ""}
            onChange={(e) => onChange({ attribute_id: attr.id, value_ids: selected, isOther: true, free_text: e.target.value })}
          />
        )}
      </div>
    );
  }
  if (attr.input_type === "single" && attr.values?.length) {
    const isOther = !!value?.isOther;
    return (
      <div>
        <div className="opts">
          {attr.values.map((v) => (
            <button
              key={v.id}
              type="button"
              className={"opt-btn" + (!isOther && value?.value_id === v.id ? " sel" : "")}
              onClick={() => onChange({ attribute_id: attr.id, value_id: v.id })}
            >
              {v.value}
            </button>
          ))}
          <button
            type="button"
            className={"opt-btn" + (isOther ? " sel" : "")}
            onClick={() => onChange({ attribute_id: attr.id, isOther: true, free_text: value?.free_text || "" })}
          >
            אחר
          </button>
        </div>
        {isOther && (
          <input
            type="text"
            placeholder="פרט/י..."
            value={value?.free_text || ""}
            onChange={(e) => onChange({ attribute_id: attr.id, isOther: true, free_text: e.target.value })}
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
      for (const vid of a.value_ids) out.push({ attribute_id: a.attribute_id, value_id: vid });
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

// Lets the reporter find an item either by browsing category -> sub-category -> item, or by
// typing a free-text search across the whole catalog — one method at a time, toggled by a tab bar.
// lockMainName: when set, the main category is pre-set to that name and the toggle/category step
// for it is skipped (used by the "was this inside something?" flow, which is always a bag/case).
// Reports the chosen item ({id, name}) up via onSelect; null when nothing is chosen (yet).
function ItemPicker({ categories, lockMainName, onSelect, selectedItemId }) {
  const lockedMain = lockMainName ? categories.find((m) => m.name === lockMainName) : null;
  const [mode, setMode] = useState("search"); // search first — it's the fastest path for most people
  const [mainId, setMainId] = useState(lockedMain?.id || null);
  const [subId, setSubId] = useState(null);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  useEffect(() => {
    if (lockedMain && mainId !== lockedMain.id) setMainId(lockedMain.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedMain?.id]);

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

  useEffect(() => {
    const q = query.trim();
    if (mode !== "search" || !q) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(() => { api.searchItems(q).then(setSearchResults); }, 300);
    return () => clearTimeout(t);
  }, [query, mode]);

  function switchMode(next) {
    if (next === mode) return;
    setMode(next);
    setMainId(lockedMain?.id || null);
    setSubId(null);
    setQuery("");
    setSearchResults([]);
    onSelect(null);
  }

  return (
    <>
      {mode === "category" && (
        <>
          <p className="info-note">
            <a href="#" onClick={(e) => { e.preventDefault(); switchMode("search"); }}>→ חזרה לחיפוש</a>
          </p>
          {!lockedMain && (
            <div className="q-block">
              <label>קטגוריה ראשית</label>
              <select value={mainId || ""} onChange={(e) => { setMainId(Number(e.target.value) || null); setSubId(null); onSelect(null); }}>
                <option value="">— בחר קטגוריה —</option>
                {categories.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          )}
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
          <label>מה איבדת/מצאת? התחל/י להקליד</label>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="למשל: מעיל, ארנק, משקפיים..." autoFocus />
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
          {query.trim() && !searchResults.length && <p className="muted">אין תוצאות.</p>}
          <p className="info-note">
            לא מוצא/ת? <a href="#" onClick={(e) => { e.preventDefault(); switchMode("category"); }}>בחר/י לפי קטגוריה</a>
          </p>
        </div>
      )}
    </>
  );
}

// A self-contained item picker + attributes card, used for container / contents / nearby items.
// Reports its current {item_id, item_answers} up to the parent on every change.
// lockMainName: when set (the "was this inside something?" flow), the main category is pre-set
// to that name and never shown — we already know a container is a bag/wallet/suitcase/case.
// allowNestedContents: when set (also only the "was this inside something?" flow), and the chosen
// container item can itself contain things, offer adding up to 3 more items found in that same
// container (the original item already takes up one of its 4 slots).
function SubReportPicker({ categories, label, onChange, onRemove, lockMainName, allowNestedContents }) {
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
            item_answers: flattenAnswers(answers),
            contents: nestedContents.filter((c) => c.value).map((c) => c.value),
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

        <ItemPicker categories={categories} lockMainName={lockMainName} selectedItemId={item?.id} onSelect={setItem} />

        {item && itemAttrs.map((attr, i) => (
          <div className="q-block" key={attr.id}>
            <div className="q-label"><span className="q-num">{i + 1}</span>{attrLabel(attr)}</div>
            <AttributeField attr={attr} value={answers[attr.id]} onChange={(a) => setAnswers((p) => ({ ...p, [attr.id]: a }))} />
          </div>
        ))}
        {item && !itemAttrs.length && <p className="muted">לפריט זה אין שאלות נוספות.</p>}

        {allowNestedContents && itemMeta?.can_contain_items && (
          <div style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: 10, marginTop: 10 }}>
            <LinkedItemsList
              title="פריט נוסף"
              prompt={`האם היו עוד דברים באותו ${itemMeta.name || "פריט"}?`}
              hint="ניתן להוסיף עד 3 פריטים נוספים שהיו יחד עם הפריט המקורי."
              items={nestedContents}
              setItems={setNestedContents}
              categories={categories}
              maxItems={MAX_LINKED - 1}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function LinkedItemsList({ title, prompt, hint, items, setItems, categories, lockMainName, allowNestedContents, maxItems = MAX_LINKED }) {
  const [asking, setAsking] = useState(items.length > 0 ? true : null);

  // when only one item will ever be added (e.g. the container), skip the extra "+ add" click —
  // go straight to the picker as soon as the reporter answers "yes"
  function answerYes() {
    setAsking(true);
    if (maxItems === 1 && items.length === 0) setItems([{ key: Date.now() + Math.random(), value: null }]);
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
              label={maxItems === 1 ? title : `${title} ${i + 1}`}
              lockMainName={lockMainName}
              allowNestedContents={allowNestedContents}
              onChange={(val) => setItems((prev) => prev.map((x, idx) => (idx === i ? { ...x, value: val } : x)))}
              onRemove={maxItems === 1 ? undefined : () => setItems((prev) => prev.filter((_, idx) => idx !== i))}
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

export default function CitizenWizard() {
  const [step, setStep] = useState(0);
  const [type, setType] = useState("lost");
  const [categories, setCategories] = useState([]);
  const [item, setItem] = useState(null); // {id, name}
  const [itemMeta, setItemMeta] = useState(null); // { can_be_contained, can_have_nearby, can_contain_items }
  const [itemAttrs, setItemAttrs] = useState([]);
  const [universalAttrs, setUniversalAttrs] = useState([]);
  const [answers, setAnswers] = useState({}); // attribute_id -> value (item + universal together)
  const [freeText, setFreeText] = useState(""); // "תיאור נוסף"
  const [note, setNote] = useState(""); // "הערה"
  const [contact, setContact] = useState({ contact_name: "", contact_phone: "", contact_email: "" });
  const [submitted, setSubmitted] = useState(null);

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
    setContainerItems([]);
    setNearbyItems([]);
  }, [item?.id]);

  const setAnswer = (a) => setAnswers((prev) => ({ ...prev, [a.attribute_id]: a }));
  const itemName = item?.name || "הפריט";

  async function submit() {
    const itemAttrIds = new Set(itemAttrs.map((a) => a.id));
    const universalAttrIds = new Set(universalAttrs.map((a) => a.id));
    const pick = (ids) => Object.fromEntries(Object.entries(answers).filter(([k]) => ids.has(Number(k))));

    const payload = {
      type,
      item_id: item.id,
      free_text: freeText,
      note,
      ...contact,
      item_answers: flattenAnswers(pick(itemAttrIds)),
      universal_answers: flattenAnswers(pick(universalAttrIds)),
      contents: contents.filter((c) => c.value).map((c) => c.value),
      container: containerItems[0]?.value || null,
      nearby: nearbyItems.filter((n) => n.value).map((n) => n.value),
    };
    const r = await api.createReport(payload);
    setSubmitted(r.id);
  }

  if (submitted) {
    return (
      <div className="page page-center">
        <div className="card">
          <div className="card-h">הדיווח נשלח בהצלחה</div>
          <div className="card-b">
            <p>מספר דיווח: <b>#{submitted}</b></p>
            <p className="info-note">נציגה תבדוק את הדיווח ותנסה למצוא התאמות. תישלח עדכון לפרטי הקשר שסיפקת.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-center">
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

      {step === 0 && (
        <div className="card">
          <div className="card-h">מה קרה?</div>
          <div className="card-b">
            <div className="type-card-row">
              <div className={"type-card" + (type === "lost" ? " act" : "")} onClick={() => setType("lost")}>
                <div className="type-icon">🔍</div>
                <div className="type-title">איבדתי חפץ</div>
              </div>
              <div className={"type-card" + (type === "found" ? " act" : "")} onClick={() => setType("found")}>
                <div className="type-icon">📦</div>
                <div className="type-title">מצאתי חפץ</div>
              </div>
            </div>

            <ItemPicker categories={categories} selectedItemId={item?.id} onSelect={setItem} />

            <div className="form-actions">
              <span />
              <button className="btn btn-pr btn-lg" disabled={!item} onClick={() => setStep(1)}>המשך ←</button>
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <div className="card-h">פרטי הפריט</div>
          <div className="card-b">
            {itemAttrs.length === 0 && <p className="muted">לפריט זה אין שאלות נוספות.</p>}
            {itemAttrs.map((attr, i) => (
              <div className="q-block" key={attr.id}>
                <div className="q-label"><span className="q-num">{i + 1}</span>{attrLabel(attr)}</div>
                <AttributeField attr={attr} value={answers[attr.id]} onChange={setAnswer} />
              </div>
            ))}

            {itemMeta?.can_contain_items && (
              <LinkedItemsList
                title="פריט"
                prompt={`האם ה${itemName} הכיל/ה דברים בתוכו?`}
                hint="ניתן להוסיף עד 4 פריטים הכי חשובים שהיו בפנים."
                items={contents}
                setItems={setContents}
                categories={categories}
              />
            )}

            {itemMeta?.can_be_contained && (
              <LinkedItemsList
                title="בתוך מה היה?"
                prompt="האם הפריט היה בתוך משהו (תיק, מזוודה וכד')?"
                lockMainName="מזוודות, תיקים, ארנקים, נרתיקים"
                allowNestedContents
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
                prompt={`האם היו פריטים נוספים ליד ה${itemName} שנראים ששייכים לאותו אדם?`}
                items={nearbyItems}
                setItems={setNearbyItems}
                categories={categories}
              />
            )}

            <div className="q-block">
              <label>תיאור נוסף</label>
              <textarea value={freeText} onChange={(e) => setFreeText(e.target.value)} placeholder="פרטים נוספים שיכולים לעזור לזהות את הפריט..." />
            </div>
            <div className="q-block">
              <label>הערה</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="הערה נוספת..." />
            </div>
            <div className="form-actions">
              <button className="btn" onClick={() => setStep(0)}>→ חזרה</button>
              <button className="btn btn-pr btn-lg" onClick={() => setStep(2)}>המשך ←</button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <div className="card-h">מיקום ותאריך</div>
          <div className="card-b">
            {universalAttrs.map((attr, i) => (
              <div className="q-block" key={attr.id}>
                <div className="q-label"><span className="q-num">{i + 1}</span>{attr.name}</div>
                <AttributeField attr={attr} value={answers[attr.id]} onChange={setAnswer} />
              </div>
            ))}
            <div className="form-actions">
              <button className="btn" onClick={() => setStep(1)}>→ חזרה</button>
              <button className="btn btn-pr btn-lg" onClick={() => setStep(3)}>המשך ←</button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <>
          <div className="card">
            <div className="card-h">סיכום הדיווח</div>
            <div className="card-b">
              <div className="sum-row"><span className="sum-k">סוג</span><span>{type === "lost" ? "אבדה" : "מציאה"}</span></div>
              {itemAttrs.map((attr) => answers[attr.id] && (
                <div className="sum-row" key={attr.id}>
                  <span className="sum-k">{attrLabel(attr)}</span>
                  <span>
                    {answers[attr.id].isOther
                      ? answers[attr.id].free_text
                      : answers[attr.id].value_ids
                        ? attr.values.filter((v) => answers[attr.id].value_ids.includes(v.id)).map((v) => v.value).join(", ")
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
              {freeText && <div className="sum-row"><span className="sum-k">תיאור נוסף</span><span>{freeText}</span></div>}
              {note && <div className="sum-row"><span className="sum-k">הערה</span><span>{note}</span></div>}
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
              <div className="row">
                <div className="col"><label>שם מלא</label><input type="text" value={contact.contact_name} onChange={(e) => setContact({ ...contact, contact_name: e.target.value })} /></div>
                <div className="col"><label>טלפון</label><input type="text" value={contact.contact_phone} onChange={(e) => setContact({ ...contact, contact_phone: e.target.value })} /></div>
              </div>
              <label>אימייל</label>
              <input type="email" value={contact.contact_email} onChange={(e) => setContact({ ...contact, contact_email: e.target.value })} />
            </div>
          </div>

          <div className="form-actions">
            <button className="btn" onClick={() => setStep(2)}>→ חזרה</button>
            <button className="btn btn-pr btn-lg" onClick={submit}>✓ שלח דיווח</button>
          </div>
        </>
      )}
    </div>
  );
}
