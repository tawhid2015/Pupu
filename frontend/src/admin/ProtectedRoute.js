import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getToken, verifyToken } from "./api";

export default function ProtectedRoute({ children }) {
  const [state, setState] = useState("checking"); // checking | ok | no

  useEffect(() => {
    if (!getToken()) { setState("no"); return; }
    verifyToken().then(() => setState("ok")).catch(() => setState("no"));
  }, []);

  if (state === "checking") {
    return <div style={{ minHeight: "100vh", background: "#08080d", color: "#9a93b3",
      display: "grid", placeItems: "center", fontFamily: "sans-serif" }}>Checking access…</div>;
  }
  if (state === "no") return <Navigate to="/admin/login" replace />;
  return children;
}
