// In local dev, Vite proxies /api to the server (see vite.config.js). In production, client and
// server are separate deployments, so VITE_API_URL must point at the server's own origin.
const BASE = (import.meta.env.VITE_API_URL || "") + "/api";

async function req(path, options) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  getCategories: () => req("/categories"),
  getItems: (subId) => req(`/subs/${subId}/items`),
  getItem: (itemId) => req(`/items/${itemId}`),
  searchItems: (q) => req(`/items/search?q=${encodeURIComponent(q)}`),
  getItemAttributes: (itemId) => req(`/items/${itemId}/attributes`),
  getUniversalAttributes: () => req("/universal-attributes"),

  createReport: (payload) => req("/reports", { method: "POST", body: JSON.stringify(payload) }),
  searchReports: (params) => req(`/reports?${new URLSearchParams(params)}`),
  getReport: (id) => req(`/reports/${id}`),
  getMatches: (id) => req(`/reports/${id}/matches`),
  confirmMatch: (id, otherId) => req(`/reports/${id}/matches/${otherId}/confirm`, { method: "POST" }),

  adminListItems: () => req("/admin/items"),
  adminGetItemAttributes: (itemId) => req(`/items/${itemId}/attributes`),
  adminGetUniversalAttributes: () => req("/admin/universal-attributes"),
  adminSetItemAttrWeight: (itemId, attrId, weight) =>
    req(`/admin/item-attributes/${itemId}/${attrId}`, { method: "PUT", body: JSON.stringify({ weight }) }),
  adminSetUniversalWeight: (attrId, weight) =>
    req(`/admin/universal-attributes/${attrId}`, { method: "PUT", body: JSON.stringify({ weight }) }),
  adminAddValue: (attrId, value) =>
    req(`/admin/attributes/${attrId}/values`, { method: "POST", body: JSON.stringify({ value }) }),
  adminDeleteValue: (valueId) => req(`/admin/attribute-values/${valueId}`, { method: "DELETE" }),

  adminCategories: () => req("/admin/categories"),
  adminMoveItemCategory: (itemId, subId) =>
    req(`/admin/items/${itemId}/category`, { method: "PUT", body: JSON.stringify({ sub_id: subId }) }),
  adminAddSubcategory: (mainId, name) =>
    req(`/admin/categories/${mainId}/subs`, { method: "POST", body: JSON.stringify({ name }) }),
  adminSetItemFlags: (itemId, flags) =>
    req(`/admin/items/${itemId}/flags`, { method: "PUT", body: JSON.stringify(flags) }),

  adminOtherAnswers: () => req("/admin/other-answers"),
  adminPromoteOther: (attributeId, text, retroactive) =>
    req("/admin/other-answers/promote", { method: "POST", body: JSON.stringify({ attribute_id: attributeId, text, retroactive }) }),
};
