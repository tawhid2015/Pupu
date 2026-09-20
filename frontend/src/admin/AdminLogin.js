import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminLogin } from "./api";
import { Disc3, Lock, User, LogIn } from "lucide-react";
import "./admin.css";

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await adminLogin(username.trim(), password);
      nav("/admin", { replace: true });
    } catch (err) {
      const d = err?.response?.data?.detail;
      setError(typeof d === "string" ? d : "Login failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-page" data-testid="admin-login-page">
      <div className="bg-glow glow-a" />
      <div className="bg-glow glow-b" />
      <form className="login-card" onSubmit={submit} data-testid="admin-login-form">
        <div className="login-brand">
          <Disc3 className="brand-disc" size={30} />
          <div>
            <h1>Pupu Admin</h1>
            <p>Private control dashboard</p>
          </div>
        </div>

        <label className="field">
          <User size={16} />
          <input
            data-testid="admin-username-input"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </label>
        <label className="field">
          <Lock size={16} />
          <input
            data-testid="admin-password-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <div className="login-error" data-testid="admin-login-error">{error}</div>}

        <button className="login-btn" type="submit" disabled={loading} data-testid="admin-login-submit">
          <LogIn size={16} />
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
