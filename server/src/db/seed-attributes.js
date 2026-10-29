// Universal attributes (location/date), shown on every report regardless of item.
// Not sheet-derived — the source spreadsheet's item-attribute tables only cover per-item
// questions, not these.
module.exports = {
  universal: [
    { name: "עיר",      input_type: "text",   values: [], weight: 15 },
    { name: "תאריך אירוע", input_type: "text", values: [], weight: 5 }, // frontend renders as a date picker
    { name: "מיקום מדויק", input_type: "text", values: [], weight: 3 },
  ],
};
