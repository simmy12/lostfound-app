import { useState } from "react";
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import CitizenWizard from "./pages/CitizenWizard";
import RepSearch from "./pages/RepSearch";
import Admin from "./pages/Admin";

const ROLES = [
  { id: "user", label: "משתמש", path: "/" },
  { id: "rep", label: "נציגה", path: "/rep" },
  { id: "admin", label: "אדמין", path: "/admin" },
];

function Nav() {
  const navigate = useNavigate();
  const location = useLocation();
  const current = ROLES.find((r) => r.path === location.pathname) || ROLES[0];
  return (
    <div className="top-nav">
      <div className="top-nav-title">🔍 השבת אבידה</div>
      <div className="role-switch">
        {ROLES.map((r) => (
          <button
            key={r.id}
            className={"role-btn" + (current.id === r.id ? " act" : "")}
            onClick={() => navigate(r.path)}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<CitizenWizard />} />
        <Route path="/rep" element={<RepSearch />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </HashRouter>
  );
}
