// Hebrew <-> Gregorian dates via the browser's built-in Hebrew calendar (Intl), no library needed.
// Dates are always stored as ISO (YYYY-MM-DD, Gregorian) so matching compares one format; the
// Hebrew form is for entering and for display next to the Gregorian one.

const PARTS = new Intl.DateTimeFormat("he-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric" });

// Hebrew letters for a number: 19 -> "י״ט", 5787 -> "תשפ״ז" (thousands dropped, as usual)
export function gematria(n) {
  const ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  const tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const hundreds = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"];
  n %= 1000;
  const r = n % 100;
  let s = hundreds[Math.floor(n / 100)];
  s += r === 15 ? "טו" : r === 16 ? "טז" : tens[Math.floor(r / 10)] + ones[r % 10];
  return s.length === 1 ? s + "׳" : s.slice(0, -1) + "״" + s.slice(-1);
}

const toDate = (iso) => new Date(iso + "T12:00:00");
const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// {day: 19, month: "חשוון", year: 5787} for an ISO date
export function hebrewParts(iso) {
  const p = Object.fromEntries(PARTS.formatToParts(toDate(iso)).map((x) => [x.type, x.value]));
  return { day: Number(p.day), month: p.month, year: Number(p.year) };
}

// "י״ט בחשוון תשפ״ז"
export function hebrewLabel(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
  const { day, month, year } = hebrewParts(iso);
  return `${gematria(day)} ב${month} ${gematria(year)}`;
}

// every day from `yearsBack` Hebrew-ish years ago until today, indexed for the Hebrew picker:
// years (newest first) -> months in calendar order -> days -> ISO date
let cache = null;
export function hebrewCalendar(yearsBack = 3) {
  if (cache) return cache;
  const years = new Map();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const d = new Date(today);
  d.setFullYear(d.getFullYear() - yearsBack);
  for (; d <= today; d.setDate(d.getDate() + 1)) {
    const { day, month, year } = hebrewParts(toIso(d));
    if (!years.has(year)) years.set(year, new Map());
    const months = years.get(year);
    if (!months.has(month)) months.set(month, new Map());
    months.get(month).set(day, toIso(d));
  }
  cache = [...years.entries()].reverse().map(([year, months]) => ({
    year,
    label: gematria(year),
    months: [...months.entries()].map(([name, days]) => ({ name, days: [...days.entries()].map(([day, iso]) => ({ day, label: gematria(day), iso })) })),
  }));
  return cache;
}
