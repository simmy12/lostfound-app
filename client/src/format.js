// A date-type attribute stores its answer as a raw ISO string (YYYY-MM-DD, from the native
// <input type="date">). Every other date in the app (report created_at) is shown via
// toLocaleDateString("he-IL") — display the stored value the same way instead of the raw ISO
// string, so "תאריך אירוע" and "תאריך דיווח" read consistently wherever they appear together.
import { hebrewLabel } from "./hebrewDate";

// dates show both calendars: "30.10.2026 (י״ט בחשוון תשפ״ז)"
export function formatAnswerValue(attrName, rawValue) {
  if (!rawValue) return rawValue;
  if (attrName?.includes("תאריך") && /^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    return `${new Date(rawValue).toLocaleDateString("he-IL")} (${hebrewLabel(rawValue)})`;
  }
  return rawValue;
}
