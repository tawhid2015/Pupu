import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { fetchOverview, sendControl, clearToken } from "./api";
import {
  Disc3, Server, Users, Radio, Gauge, LogOut, Search, RefreshCw,
  Pause, Play, SkipForward, Square, LogOut as Leave, Music4, Volume2, Dot,
} from "lucide-react";
import "./admin.css";

const fmt = (ms) => {
  if (!ms && ms !== 0) return "0:00";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
};

function Stat({ icon: Icon, label, value, accent, testid }) {
  return (
    <div className="a-stat" data-testid={testid}>
      <div className="a-stat-icon" style={{ color: accent }}><Icon size={18} /></div>
      <div>
        <div className="a-stat-value" data-testid={`${testid}-value`}>{value}</div>
        <div className="a-stat-label">{label}</div>
      </div>
    </div>
  );
}

function ServerRow({ s, onControl, busy }) {
  const live = s.voice_connected;
  const p = s.playing;
  const pct = p && p.length ? Math.min(100, (p.position / p.length) * 100) : 0;
  return (
    <div className={`a-server ${live ? "live" : ""}`} data-testid={`server-row-${s.id}`}>
      <div className="a-server-head">
        {s.icon
          ? <img src={s.icon} alt="" className="a-icon" />
          : <div className="a-icon a-icon-fb">{s.name?.[0] || "?"}</div>}
        <div className="a-server-meta">
          <div className="a-server-name" title={s.name}>{s.name}</div>
          <div className="a-server-sub">
            <span><Users size={12} /> {s.members.toLocaleString()}</span>
            {live
              ? <span className="voice-on" data-testid={`voice-badge-${s.id}`}>
                  <Radio size={12} /> {s.voice_channel} · {s.listeners} listening
                </span>
              : <span className="voice-off"><Dot size={16} /> idle</span>}
          </div>
        </div>
      </div>

      {live && p && (
        <div className="a-now">
          {p.artwork
            ? <img src={p.artwork} alt="" className="a-now-art" />
            : <div className="a-now-art a-now-art-fb"><Music4 size={18} /></div>}
          <div className="a-now-body">
            <a href={p.uri} target="_blank" rel="noreferrer" className="a-now-title">{p.title}</a>
            <div className="a-now-author">{p.author} · {s.source || p.source || "source"}</div>
            <div className="a-bar"><span style={{ width: `${pct}%` }} /></div>
            <div className="a-now-time">
              <span>{fmt(p.position)} / {fmt(p.length)}</span>
              <span>vol {s.volume}% · queue {s.queue_len} · {s.loop}</span>
            </div>
          </div>
        </div>
      )}

      {live && (
        <div className="a-controls" data-testid={`controls-${s.id}`}>
          <button disabled={busy} onClick={() => onControl(s.id, s.paused ? "resume" : "pause")}
                  data-testid={`ctrl-pauseresume-${s.id}`}>
            {s.paused ? <Play size={14} /> : <Pause size={14} />}{s.paused ? "Resume" : "Pause"}
          </button>
          <button disabled={busy} onClick={() => onControl(s.id, "skip")} data-testid={`ctrl-skip-${s.id}`}>
            <SkipForward size={14} /> Skip
          </button>
          <button disabled={busy} onClick={() => onControl(s.id, "stop")} data-testid={`ctrl-stop-${s.id}`}>
            <Square size={14} /> Stop
          </button>
          <button disabled={busy} className="danger" onClick={() => onControl(s.id, "leave")}
                  data-testid={`ctrl-leave-${s.id}`}>
            <Leave size={14} /> Leave
          </button>
          <div className="a-vol">
            <Volume2 size={14} />
            <input type="range" min="0" max="100" defaultValue={s.volume ?? 60}
                   onMouseUp={(e) => onControl(s.id, "volume", Number(e.target.value))}
                   onTouchEnd={(e) => onControl(s.id, "volume", Number(e.target.value))}
                   data-testid={`ctrl-volume-${s.id}`} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [query, setQuery] = useState("");
  const [onlyVoice, setOnlyVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const nav = useNavigate();

  const load = useCallback(async () => {
    try {
      setData(await fetchOverview());
    } catch (e) {
      if (e?.response?.status === 401) {
        clearToken();
        nav("/admin/login", { replace: true });
      }
    }
  }, [nav]);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  const onControl = async (guild_id, action, value = null) => {
    setBusy(true);
    try {
      const res = await sendControl(guild_id, action, value);
      setToast(res.ok ? `✓ ${action} sent` : `⚠ ${res.result}`);
    } catch {
      setToast("⚠ command failed");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(""), 2500);
      load();
    }
  };

  const logout = () => { clearToken(); nav("/admin/login", { replace: true }); };

  const servers = useMemo(() => {
    let list = data?.servers || [];
    if (onlyVoice) list = list.filter((s) => s.voice_connected);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((s) => s.name?.toLowerCase().includes(q) || s.id.includes(q));
    }
    return list;
  }, [data, onlyVoice, query]);

  const online = data?.online;

  return (
    <div className="admin-page" data-testid="admin-dashboard">
      <div className="bg-glow glow-a" />
      <header className="a-top">
        <div className="a-brand"><Disc3 className="brand-disc" size={22} /> Pupu Admin</div>
        <div className="a-top-right">
          <span className={`a-pill ${online ? "on" : "off"}`} data-testid="admin-status-pill">
            <span className="dot" /> {online ? "Online" : "Offline"}
          </span>
          <button className="a-icon-btn" onClick={load} title="Refresh" data-testid="admin-refresh">
            <RefreshCw size={16} />
          </button>
          <button className="a-icon-btn" onClick={logout} title="Logout" data-testid="admin-logout">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <section className="a-stats">
        <Stat icon={Server} label="Servers" value={data?.guilds ?? "—"} accent="#b388ff" testid="admin-stat-servers" />
        <Stat icon={Users} label="Total Members" value={data?.users?.toLocaleString?.() ?? "—"} accent="#7c5cff" testid="admin-stat-users" />
        <Stat icon={Radio} label="In Voice" value={data?.active_voice ?? 0} accent="#4ade80" testid="admin-stat-voice" />
        <Stat icon={Music4} label="Playing" value={data?.active_players ?? 0} accent="#f59e0b" testid="admin-stat-playing" />
        <Stat icon={Gauge} label="Latency" value={data?.latency_ms != null ? `${data.latency_ms}ms` : "—"} accent="#38bdf8" testid="admin-stat-latency" />
      </section>

      <div className="a-toolbar">
        <div className="a-search">
          <Search size={15} />
          <input placeholder="Search servers by name or ID…" value={query}
                 onChange={(e) => setQuery(e.target.value)} data-testid="admin-search" />
        </div>
        <button className={`a-filter ${onlyVoice ? "active" : ""}`} onClick={() => setOnlyVoice((v) => !v)}
                data-testid="admin-filter-voice">
          <Radio size={14} /> In voice only
        </button>
        <span className="a-count" data-testid="admin-server-count">{servers.length} shown</span>
      </div>

      <section className="a-server-list" data-testid="admin-server-list">
        {!data ? (
          <div className="a-empty">Loading…</div>
        ) : servers.length === 0 ? (
          <div className="a-empty" data-testid="admin-no-servers">No servers match.</div>
        ) : (
          servers.map((s) => <ServerRow key={s.id} s={s} onControl={onControl} busy={busy} />)
        )}
      </section>

      {toast && <div className="a-toast" data-testid="admin-toast">{toast}</div>}
    </div>
  );
}
