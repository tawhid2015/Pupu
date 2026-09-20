import { useEffect, useState, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import {
  Activity, Radio, Server, Users, Gauge, Music4, Pause, Play,
  Terminal, Command, Disc3, Zap, ListMusic, Volume2, Repeat, Shuffle,
} from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const fmt = (ms) => {
  if (!ms && ms !== 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const COMMANDS = [
  { g: "Playback", icon: Play, items: [
    ["play <song/url>", "Search & play or queue a track"],
    ["pause / resume", "Pause or resume playback"],
    ["skip / stop", "Skip current or stop everything"],
    ["nowplaying", "Show the current track"],
    ["seek <time>", "Jump to 1:30 or 90"],
  ]},
  { g: "Queue", icon: ListMusic, items: [
    ["queue", "List upcoming tracks"],
    ["shuffle", "Shuffle the queue"],
    ["remove <#>", "Remove a track by number"],
    ["clear", "Empty the queue"],
    ["loop", "Off / track / queue repeat"],
  ]},
  { g: "Voice", icon: Volume2, items: [
    ["join / leave", "Connect or disconnect Pupu"],
    ["volume <0-100>", "Set the volume"],
    ["help", "Show every command"],
  ]},
];

function StatCard({ icon: Icon, label, value, accent, testid }) {
  return (
    <div className="stat-card" data-testid={testid}>
      <div className="stat-icon" style={{ color: accent }}>
        <Icon size={20} strokeWidth={2.2} />
      </div>
      <div className="stat-value" data-testid={`${testid}-value`}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function NowPlaying({ p }) {
  const pct = p.length ? Math.min(100, (p.position / p.length) * 100) : 0;
  return (
    <div className="np-card" data-testid="now-playing-card">
      <div className="np-art-wrap">
        {p.artwork
          ? <img src={p.artwork} alt="" className="np-art" />
          : <div className="np-art np-art-fallback"><Disc3 size={38} /></div>}
        <div className={`np-badge ${p.paused ? "paused" : "live"}`}>
          {p.paused ? <Pause size={12} /> : <Play size={12} />}
          {p.paused ? "Paused" : "Live"}
        </div>
      </div>
      <div className="np-body">
        <div className="np-guild"><Server size={12} /> {p.guild}</div>
        <a href={p.uri} target="_blank" rel="noreferrer" className="np-title" data-testid="np-title">
          {p.title}
        </a>
        <div className="np-author">{p.author}</div>
        <div className="np-progress">
          <div className="np-bar"><span style={{ width: `${pct}%` }} /></div>
          <div className="np-time"><span>{fmt(p.position)}</span><span>{fmt(p.length)}</span></div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/bot/status`);
      setStatus(data);
    } catch (e) {
      setStatus((s) => s || { online: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const online = status?.online;
  const players = status?.players || [];

  return (
    <div className="page" data-testid="pupu-status-page">
      <div className="bg-grain" />
      <div className="bg-glow glow-a" />
      <div className="bg-glow glow-b" />

      <header className="topbar">
        <div className="brand" data-testid="brand">
          <Disc3 className="brand-disc" size="22" />
          <span>Pupu</span>
        </div>
        <div className={`status-pill ${online ? "on" : "off"}`} data-testid="status-pill">
          <span className="dot" />
          {loading ? "Connecting…" : online ? "Online" : "Offline"}
        </div>
      </header>

      <section className="hero">
        <div className="hero-avatar-wrap">
          {status?.avatar
            ? <img src={status.avatar} alt="Pupu" className="hero-avatar" data-testid="bot-avatar" />
            : <div className="hero-avatar hero-avatar-fallback"><Music4 size={44} /></div>}
          <span className={`ring ${online ? "on" : ""}`} />
        </div>
        <p className="eyebrow"><Radio size={13} /> Discord Music Bot · Lavalink v4</p>
        <h1 className="hero-title">Meet <span>{status?.name?.split("#")[0] || "Pupu"}</span></h1>
        <p className="hero-sub">
          High-quality music streaming for your server. Every command works with a
          <code>.</code> prefix <em>and</em> as a <code>/</code> slash command.
        </p>
      </section>

      <section className="stats">
        <StatCard icon={Server} label="Servers" value={status?.guilds ?? "—"} accent="#b388ff" testid="stat-servers" />
        <StatCard icon={Users} label="Listeners" value={status?.users?.toLocaleString?.() ?? "—"} accent="#7c5cff" testid="stat-users" />
        <StatCard icon={Music4} label="Now Playing" value={status?.active_players ?? 0} accent="#4ade80" testid="stat-players" />
        <StatCard icon={Gauge} label="Latency" value={status?.latency_ms != null ? `${status.latency_ms}ms` : "—"} accent="#38bdf8" testid="stat-latency" />
      </section>

      <section className="live-section">
        <div className="section-head">
          <h2><Activity size={18} /> Live Sessions</h2>
          <span className="live-count" data-testid="live-count">{players.length} active</span>
        </div>
        {players.length === 0 ? (
          <div className="empty" data-testid="empty-live">
            <Disc3 size={30} />
            <p>Nothing spinning right now. Hop into a voice channel and run <code>.play</code>.</p>
          </div>
        ) : (
          <div className="np-grid">
            {players.map((p, i) => <NowPlaying key={i} p={p} />)}
          </div>
        )}
      </section>

      <section className="cmd-section">
        <div className="section-head">
          <h2><Terminal size={18} /> Commands</h2>
          <div className="prefix-tags">
            <span className="tag"><Command size={12} /> /slash</span>
            <span className="tag alt"><Zap size={12} /> .prefix</span>
          </div>
        </div>
        <div className="cmd-grid">
          {COMMANDS.map((c) => (
            <div className="cmd-card" key={c.g} data-testid={`cmd-group-${c.g.toLowerCase()}`}>
              <div className="cmd-card-head"><c.icon size={16} /> {c.g}</div>
              <ul>
                {c.items.map(([cmd, desc]) => (
                  <li key={cmd}>
                    <code>{cmd}</code>
                    <span>{desc}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer className="foot">
        <span><Shuffle size={13} /> <Repeat size={13} /> Pupu · powered by Lavalink v4 + Wavelink</span>
      </footer>
    </div>
  );
}

export default App;
