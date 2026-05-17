import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const uid = () => Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-");
const store = {
  get: (key, fallback = null) => {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      console.error(`[storage:get:${key}]`, error);
      return fallback;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`[storage:set:${key}]`, error);
    }
  },
  del: (key) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`[storage:del:${key}]`, error);
    }
  }
};

const priorityColor = { High: "#ef4444", Medium: "#f59e0b", Low: "#22c55e" };
const priorityBg = { High: "rgba(239,68,68,0.12)", Medium: "rgba(245,158,11,0.12)", Low: "rgba(34,197,94,0.12)" };
const focusSettingsKey = "masari_focus_settings";
const focusStatsKey = "masari_focus_stats";
const focusGardenKey = "masari_focus_garden";
const focusFlightKey = "masari_focus_flight";
const candleFocusKey = "masari_candle_focus";
const latestQuizKey = "masari_latest_quiz";
const aiCacheKey = "masari_ai_cache";
const aiCooldownMs = 7000;
const splashDuration = 2800;
const defaultTasks = [
  { id: uid(), title: "Study Chapter 4 - Algorithms", priority: "High", isCompleted: false, createdAt: nowIso() },
  { id: uid(), title: "Submit Math Assignment", priority: "High", isCompleted: true, createdAt: nowIso() },
  { id: uid(), title: "Read Research Paper", priority: "Medium", isCompleted: false, createdAt: nowIso() },
  { id: uid(), title: "Prepare Presentation Slides", priority: "Medium", isCompleted: false, createdAt: nowIso() },
  { id: uid(), title: "Review English Grammar Notes", priority: "Low", isCompleted: true, createdAt: nowIso() }
];
const defaultNotes = [
  { id: uid(), title: "Data Structures Summary", content: "Arrays, linked lists, trees, graphs, and Big O notes for common operations.", createdAt: nowIso() },
  { id: uid(), title: "Exam Prep: Calculus", content: "Focus on integrals, derivatives, and the chain rule. Practice problems from chapters 5-8.", createdAt: nowIso() },
  { id: uid(), title: "Project Ideas", content: "1. AI chatbot  2. Smart calendar  3. Study tracker app. Pick one by next week.", createdAt: nowIso() }
];
const defaultAiMessages = [];
const flightCities = {
  Cairo: [58, 63],
  Amsterdam: [47, 31],
  Paris: [44, 36],
  London: [42, 31],
  Dubai: [66, 66],
  Tokyo: [86, 45],
  "New York": [20, 42]
};
const flightTrips = [
  { id: "ams", label: "Cairo -> Amsterdam", from: "Cairo", to: "Amsterdam", distance: 3280 },
  { id: "paris", label: "Cairo -> Paris", from: "Cairo", to: "Paris", distance: 3210 },
  { id: "london", label: "Cairo -> London", from: "Cairo", to: "London", distance: 3510 },
  { id: "dubai", label: "Cairo -> Dubai", from: "Cairo", to: "Dubai", distance: 2420 },
  { id: "tokyo", label: "Cairo -> Tokyo", from: "Cairo", to: "Tokyo", distance: 9560 },
  { id: "new-york", label: "Cairo -> New York", from: "Cairo", to: "New York", distance: 9020 }
];

const safeNumber = (value, fallback, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};
const safeFocusSettings = (value) => ({
  focus: safeNumber(value?.focus, 25, 1, 180),
  break: safeNumber(value?.break, 5, 1, 60),
  sessions: Math.round(safeNumber(value?.sessions, 4, 1, 12))
});
const safeGarden = (value) => ({
  minutes: safeNumber(value?.minutes, 0, 0, 100000),
  sessionsCompleted: Math.round(safeNumber(value?.sessionsCompleted, 0, 0, 10000))
});
const defaultFocusStats = {
  totalMinutes: 0,
  sessionsCompleted: 0,
  xp: 0,
  streak: 0,
  longestStreak: 0,
  lastSessionDay: "",
  history: []
};
const safeFocusStats = (value) => ({
  totalMinutes: safeNumber(value?.totalMinutes, 0, 0, 100000),
  sessionsCompleted: Math.round(safeNumber(value?.sessionsCompleted, 0, 0, 10000)),
  xp: safeNumber(value?.xp, 0, 0, 1000000),
  streak: Math.round(safeNumber(value?.streak, 0, 0, 3650)),
  longestStreak: Math.round(safeNumber(value?.longestStreak, 0, 0, 3650)),
  lastSessionDay: typeof value?.lastSessionDay === "string" ? value.lastSessionDay : "",
  history: Array.isArray(value?.history) ? value.history.slice(0, 30).map((entry) => ({
    id: entry?.id || uid(),
    date: typeof entry?.date === "string" ? entry.date : nowIso(),
    minutes: safeNumber(entry?.minutes, 0, 0, 600),
    xp: safeNumber(entry?.xp, 0, 0, 5000)
  })) : []
});
const safeCandleFocus = (value) => ({
  preset: safeNumber(value?.preset, 60, 15, 180),
  glow: safeNumber(value?.glow, 72, 20, 100),
  ambience: typeof value?.ambience === "string" ? value.ambience : "Library hush",
  soundOn: Boolean(value?.soundOn),
  previewSeconds: safeNumber(value?.previewSeconds, 60 * 60, 60, 180 * 60)
});
const safeTasks = (value) => Array.isArray(value) ? value.map((task) => ({
  id: task?.id || uid(),
  title: typeof task?.title === "string" ? task.title : "",
  priority: ["High", "Medium", "Low"].includes(task?.priority) ? task.priority : "Medium",
  isCompleted: Boolean(task?.isCompleted),
  createdAt: typeof task?.createdAt === "string" ? task.createdAt : nowIso()
})).filter((task) => task.title.trim()) : [];
const safeNotes = (value) => Array.isArray(value) ? value.map((note) => ({
  id: note?.id || uid(),
  title: typeof note?.title === "string" ? note.title : "",
  content: typeof note?.content === "string" ? note.content : "",
  createdAt: typeof note?.createdAt === "string" ? note.createdAt : nowIso()
})).filter((note) => note.title.trim()) : [];
const safeProfile = (value, authUser = null) => ({
  id: authUser?.uid || value?.id || "",
  name: typeof value?.name === "string" && value.name.trim() ? value.name : authUser?.displayName || "",
  email: typeof value?.email === "string" && value.email.trim() ? value.email : authUser?.email || "",
  level: typeof value?.level === "string" ? value.level : "Freshman",
  age: value?.age ?? "",
  gender: typeof value?.gender === "string" ? value.gender : "Male",
  photoURL: typeof value?.photoURL === "string" ? value.photoURL : authUser?.photoURL || "",
  createdAt: typeof value?.createdAt === "string" ? value.createdAt : nowIso()
});
const safeAiMessages = (value, userName = "there") => {
  const messages = Array.isArray(value)
    ? value
      .filter((message) => message && typeof message.text === "string" && message.text.trim())
      .map((message) => ({ role: message.role === "user" ? "user" : "assistant", text: message.text }))
    : [];
  return messages.length ? messages : [{ role: "assistant", text: `Hi ${String(userName || "there").split(" ")[0] || "there"}! I'm Masari Buddy. Upload a PDF, DOCX, or TXT file, or ask me for study help.` }];
};
const defaultFlight = {
  tripId: "ams",
  origin: "Cairo",
  destination: "Amsterdam",
  hours: 4,
  minutes: 0,
  elapsedSeconds: 0,
  totalSeconds: 4 * 60 * 60,
  mode: "solo",
  syncStartMinutes: 0,
  status: "ready",
  startedAt: null,
  lastElapsedSeconds: 0,
  arrived: false,
  xp: 0
};
const safeFlight = (value) => {
  const base = { ...defaultFlight, ...(value && typeof value === "object" ? value : {}) };
  const hours = safeNumber(base.hours, 4, 0, 48);
  const minutes = safeNumber(base.minutes, 0, 0, 59);
  const totalSeconds = Math.max(60, Math.round(hours * 3600 + minutes * 60));
  const status = ["ready", "flying", "paused", "arrived"].includes(base.status) ? base.status : "ready";
  return {
    ...base,
    tripId: flightTrips.some((trip) => trip.id === base.tripId) ? base.tripId : "ams",
    origin: flightCities[base.origin] ? base.origin : "Cairo",
    destination: flightCities[base.destination] ? base.destination : "Amsterdam",
    hours,
    minutes,
    totalSeconds,
    mode: base.mode === "sync" ? "sync" : "solo",
    syncStartMinutes: safeNumber(base.syncStartMinutes, 0, 0, 100000),
    elapsedSeconds: safeNumber(base.elapsedSeconds, 0, 0, totalSeconds),
    lastElapsedSeconds: safeNumber(base.lastElapsedSeconds, base.elapsedSeconds || 0, 0, totalSeconds),
    status,
    startedAt: status === "flying" && Number.isFinite(Number(base.startedAt)) ? Number(base.startedAt) : null,
    arrived: Boolean(base.arrived),
    xp: safeNumber(base.xp, 0, 0, 1000000)
  };
};

const dayStamp = (value = new Date()) => new Date(value).toISOString().slice(0, 10);
const previousDayStamp = (stamp) => {
  if (!stamp) return "";
  const date = new Date(`${stamp}T00:00:00`);
  date.setDate(date.getDate() - 1);
  return dayStamp(date);
};
const cloudKey = (uid, key) => `masari_${uid}_${key}`;
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const applyFocusSession = (current, minutes) => {
  const today = dayStamp();
  const gainedXp = Math.max(8, Math.round(minutes * 2.4));
  const streak = current.lastSessionDay === today
    ? current.streak
    : current.lastSessionDay === previousDayStamp(today)
      ? current.streak + 1
      : 1;
  return safeFocusStats({
    ...current,
    totalMinutes: current.totalMinutes + minutes,
    sessionsCompleted: current.sessionsCompleted + 1,
    xp: current.xp + gainedXp,
    streak,
    longestStreak: Math.max(current.longestStreak, streak),
    lastSessionDay: today,
    history: [{ id: uid(), date: nowIso(), minutes, xp: gainedXp }, ...current.history].slice(0, 30)
  });
};

function useUserDocState(userId, key, fallbackValue, sanitize) {
  const fallbackStorageKey = userId ? cloudKey(userId, key) : null;
  const [state, setState] = useState(() => sanitize(fallbackStorageKey ? store.get(fallbackStorageKey, fallbackValue) : fallbackValue));
  const [loading, setLoading] = useState(false);
  const [error] = useState("");

  useEffect(() => {
    if (!fallbackStorageKey) {
      setState(sanitize(fallbackValue));
      setLoading(false);
      return;
    }
    const fallback = sanitize(store.get(fallbackStorageKey, fallbackValue));
    setState((current) => sameJson(current, fallback) ? current : fallback);
  }, [fallbackStorageKey, fallbackValue, sanitize]);

  useEffect(() => {
    if (!fallbackStorageKey) return;
    store.set(fallbackStorageKey, state);
  }, [fallbackStorageKey, state]);

  return [state, setState, { loading, error }];
}

function Buddy({ size = 80, anim = true }) {
  return (
    <div style={{ width: size, height: size }} className={anim ? "buddy buddy-float" : "buddy"}>
      <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <radialGradient id={`bg-${size}`} cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#7c3aed" /><stop offset="100%" stopColor="#4c1d95" /></radialGradient>
          <radialGradient id={`face-${size}`} cx="50%" cy="40%" r="50%"><stop offset="0%" stopColor="#1e1b4b" /><stop offset="100%" stopColor="#0f0b2d" /></radialGradient>
        </defs>
        <circle cx="40" cy="40" r="38" fill="none" stroke="#a3e635" strokeWidth="1.5" strokeOpacity="0.5" />
        <circle cx="40" cy="40" r="34" fill={`url(#bg-${size})`} />
        <ellipse cx="40" cy="44" rx="22" ry="20" fill={`url(#face-${size})`} />
        <rect x="18" y="20" width="44" height="8" rx="3" fill="#1e1b4b" />
        <rect x="14" y="24" width="52" height="5" rx="2.5" fill="#2d1f5e" />
        <polygon points="40,5 52,22 28,22" fill="#7c3aed" />
        <circle cx="40" cy="5" r="3" fill="#a3e635" />
        <line x1="52" y1="14" x2="58" y2="22" stroke="#a3e635" strokeWidth="1.5" />
        <circle cx="58" cy="24" r="3" fill="#a3e635" opacity="0.8" />
        <ellipse cx="33" cy="42" rx="4" ry="4.5" fill="#7c3aed" opacity="0.9" />
        <ellipse cx="47" cy="42" rx="4" ry="4.5" fill="#7c3aed" opacity="0.9" />
        <ellipse cx="33" cy="42" rx="2.5" ry="3" fill="#a3e635" />
        <ellipse cx="47" cy="42" rx="2.5" ry="3" fill="#a3e635" />
        <circle cx="34" cy="41" r="1" fill="white" />
        <circle cx="48" cy="41" r="1" fill="white" />
        <path d="M32 52 Q40 58 48 52" stroke="#a3e635" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <ellipse cx="26" cy="50" rx="4" ry="3" fill="#ec4899" opacity="0.3" />
        <ellipse cx="54" cy="50" rx="4" ry="3" fill="#ec4899" opacity="0.3" />
      </svg>
    </div>
  );
}

function Landing({ onStart, onLogin }) {
  const features = [
    { icon: "✓", color: "#7c3aed", title: "Smart Tasks", text: "Priority task management" },
    { icon: "N", color: "#a855f7", title: "Study Notes", text: "Searchable rich notes" },
    { icon: "25", color: "#a3e635", title: "Pomodoro", text: "Focus and break sessions" },
    { icon: "AI", color: "#ec4899", title: "AI Buddy", text: "Document-aware study help" }
  ];

  return (
    <main className="mesh landing">
      <nav className="topbar">
        <div className="brand"><Buddy size={36} anim={false} /><span>Masari</span></div>
        <div className="row">
          <button className="btn-ghost" onClick={onLogin}>Login</button>
          <button className="btn-primary" onClick={onStart}>Get Started</button>
        </div>
      </nav>
      <section className="hero fade-in">
        <div className="buddy-pulse"><Buddy size={100} /></div>
        <h1><span>Empowering</span><strong>Student Productivity</strong></h1>
        <p>A smart academic ecosystem. Manage tasks, notes, focus sessions, and get AI-powered study assistance all in one place.</p>
        <div className="hero-actions">
          <button className="btn-lime" onClick={onStart}>Get Started Free</button>
          <button className="btn-ghost large" onClick={onLogin}>Sign In</button>
        </div>
      </section>
      <section className="feature-grid">
        {features.map((feature) => (
          <article className="card center" key={feature.title}>
            <div className="feature-icon" style={{ color: feature.color }}>{feature.icon}</div>
            <h3 style={{ color: feature.color }}>{feature.title}</h3>
            <p>{feature.text}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

function Auth({ mode, onSuccess, onToggle }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", level: "Freshman", age: "", gender: "Male" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const update = (key) => (event) => setForm((next) => ({ ...next, [key]: event.target.value }));

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      const users = store.get("mu", {});
      if (mode === "signup") {
        if (!form.name || !form.email || !form.password) throw new Error("Please fill all required fields.");
        if (form.password.length < 6) throw new Error("Password must be at least 6 characters.");
        if (users[form.email]) throw new Error("Email already registered.");
        const user = { ...form, id: uid(), createdAt: nowIso() };
        users[form.email] = user;
        store.set("mu", users);
        onSuccess(user);
        return;
      }
      const user = users[form.email];
      if (!user || user.password !== form.password) throw new Error("Invalid credentials.");
      onSuccess(user);
    } catch (nextError) {
      console.error("[auth:submit]", nextError);
      setError(nextError.message || "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setError("Google sign-in is temporarily disabled.");
  };

  return (
    <main className="mesh auth-page">
      <section className="auth-card glass2 fade-in">
        <Buddy size={58} />
        <h2>{mode === "signup" ? "Create Account" : "Welcome Back"}</h2>
        <p>Masari</p>
        <div className="form-stack">
          {mode === "signup" && <input className="input" placeholder="Full Name *" value={form.name} onChange={update("name")} />}
          <input className="input" type="email" placeholder="Email *" value={form.email} onChange={update("email")} />
          <input className="input" type="password" placeholder="Password *" value={form.password} onChange={update("password")} />
          {mode === "signup" && (
            <>
              <select className="input" value={form.level} onChange={update("level")}>{["Freshman", "Sophomore", "Junior", "Senior", "Graduate"].map((item) => <option key={item}>{item}</option>)}</select>
              <div className="two-col">
                <input className="input" type="number" placeholder="Age" min="10" max="60" value={form.age} onChange={update("age")} />
                <select className="input" value={form.gender} onChange={update("gender")}><option>Male</option><option>Female</option><option>Other</option></select>
              </div>
            </>
          )}
          {error && <p className="error">{error}</p>}
          <button className="btn-lime" disabled={loading} onClick={submit}>{loading ? "Loading..." : mode === "signup" ? "Create Account" : "Login"}</button>
          <button className="btn-ghost" disabled onClick={loginWithGoogle}>Continue with Google</button>
        </div>
        <p className="switch">{mode === "signup" ? "Have an account? " : "New here? "}<button onClick={onToggle}>{mode === "signup" ? "Login" : "Sign Up"}</button></p>
      </section>
    </main>
  );
}

const navItems = [
  { id: "dashboard", icon: "D", label: "Dashboard" },
  { id: "tasks", icon: "T", label: "Tasks" },
  { id: "notes", icon: "N", label: "Notes" },
  { id: "pomodoro", icon: "25", label: "Pomodoro" },
  { id: "garden", icon: "G", label: "Focus Garden" },
  { id: "flight", icon: "F", label: "Focus Flight" },
  { id: "candle", icon: "C", label: "Candle Focus" },
  { id: "ai", icon: "AI", label: "AI Assistant" },
  { id: "evolution", icon: "*", label: "AI Evolution" },
  { id: "profile", icon: "P", label: "Profile" }
];

function Sidebar({ active, onNav, user, onLogout }) {
  return (
    <aside className="sidebar glass2">
      <div className="brand compact"><Buddy size={32} anim={false} /><span>Masari</span></div>
      <nav className="side-nav">
        {navItems.map((item) => (
          <button key={item.id} className={`sidebar-item ${active === item.id ? "active" : ""}`} onClick={() => onNav(item.id)}>
            <span>{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
      <div className="user-mini">
        <div className="avatar">{user.name?.[0]?.toUpperCase() || "S"}</div>
        <div><strong>{user.name?.split(" ")[0] || "Student"}</strong><small>{user.level || "Student"}</small></div>
      </div>
      <button className="sidebar-item danger" onClick={onLogout}>Logout</button>
    </aside>
  );
}

function Dashboard({ user, onNav, tasks, notes, focusStats }) {
  const done = tasks.filter((task) => task.isCompleted).length;
  const pending = tasks.length - done;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const stats = [
    { label: "Total Tasks", value: tasks.length, color: "#7c3aed" },
    { label: "Completed", value: done, color: "#a3e635" },
    { label: "Pending", value: pending, color: "#f59e0b" },
    { label: "Notes", value: notes.length, color: "#38bdf8" },
    { label: "Focus XP", value: focusStats.xp, color: "#bef264" }
  ];
  return (
    <section className="fade-in stack">
      <div className="welcome glass">
        <Buddy size={52} />
        <div><p>{greeting}</p><h2>{user.name || "Student"}</h2><strong>{user.level} · Let's crush your goals today.</strong></div>
      </div>
      <div className="stat-grid">{stats.map((stat) => <article className="stat-card" key={stat.label}><p>{stat.label}</p><strong style={{ color: stat.color }}>{stat.value}</strong></article>)}</div>
      <div className="dashboard-grid">
        <article className="glass panel"><h3>Quick Actions</h3>{[{ label: "Add Task", nav: "tasks" }, { label: "New Note", nav: "notes" }, { label: "Start Focus", nav: "pomodoro" }, { label: "Open Garden", nav: "garden" }, { label: "Plan a Flight", nav: "flight" }, { label: "AI Buddy", nav: "ai" }].map((item) => <button className="btn-ghost action" key={item.label} onClick={() => onNav(item.nav)}>{item.label}</button>)}</article>
        <article className="glass panel"><h3>Recent Tasks</h3>{tasks.slice(0, 4).map((task) => <div className="task-row mini" key={task.id}><span style={{ background: priorityColor[task.priority] }} /><p className={task.isCompleted ? "done" : ""}>{task.title}</p>{task.isCompleted && <b>Done</b>}</div>)}</article>
      </div>
    </section>
  );
}

function Tasks({ tasks, setTasks }) {
  const [form, setForm] = useState({ title: "", priority: "Medium" });
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState({ status: "all", priority: "all" });
  const [showForm, setShowForm] = useState(false);
  const save = (next) => setTasks(safeTasks(next));
  const add = () => {
    if (!form.title.trim()) return;
    if (editing) save(tasks.map((task) => task.id === editing ? { ...task, ...form } : task));
    else save([...tasks, { id: uid(), ...form, isCompleted: false, createdAt: nowIso() }]);
    setForm({ title: "", priority: "Medium" });
    setEditing(null);
    setShowForm(false);
  };
  const filtered = tasks.filter((task) => (filter.status === "all" || (filter.status === "done") === task.isCompleted) && (filter.priority === "all" || task.priority === filter.priority));

  return (
    <section className="fade-in stack">
      <div className="section-head"><h2>Task Management</h2><button className="btn-primary" onClick={() => setShowForm(true)}>+ New Task</button></div>
      {showForm && <div className="glass2 edit-box"><input className="input" placeholder="Task title..." value={form.title} onChange={(e) => setForm((next) => ({ ...next, title: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && add()} /><select className="input" value={form.priority} onChange={(e) => setForm((next) => ({ ...next, priority: e.target.value }))}><option>High</option><option>Medium</option><option>Low</option></select><button className="btn-primary" onClick={add}>{editing ? "Save" : "Add"}</button><button className="btn-ghost" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</button></div>}
      <div className="filters">{["all", "pending", "done"].map((status) => <button key={status} className={filter.status === status ? "btn-primary" : "btn-ghost"} onClick={() => setFilter((next) => ({ ...next, status }))}>{status}</button>)}{["all", "High", "Medium", "Low"].map((priority) => <button key={priority} className={filter.priority === priority ? "btn-primary" : "btn-ghost"} onClick={() => setFilter((next) => ({ ...next, priority }))}>{priority}</button>)}</div>
      <div className="stack small">{filtered.length === 0 ? <p>No tasks found.</p> : filtered.map((task) => <div className="glass task-item" key={task.id} style={{ borderLeftColor: priorityColor[task.priority] }}><button className={`check ${task.isCompleted ? "on" : ""}`} onClick={() => save(tasks.map((item) => item.id === task.id ? { ...item, isCompleted: !item.isCompleted } : item))}>✓</button><p className={task.isCompleted ? "done" : ""}>{task.title}</p><span className="tag" style={{ background: priorityBg[task.priority], color: priorityColor[task.priority] }}>{task.priority}</span><small>{fmt(task.createdAt)}</small><button className="icon-btn" onClick={() => { setForm({ title: task.title, priority: task.priority }); setEditing(task.id); setShowForm(true); }}>Edit</button><button className="icon-btn danger-text" onClick={() => save(tasks.filter((item) => item.id !== task.id))}>Delete</button></div>)}</div>
    </section>
  );
}

function Notes({ notes, setNotes }) {
  const [form, setForm] = useState({ title: "", content: "" });
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState(null);
  const save = (next) => setNotes(safeNotes(next));
  const saveNote = () => {
    if (!form.title.trim()) return;
    if (editing) save(notes.map((note) => note.id === editing ? { ...note, ...form } : note));
    else save([{ id: uid(), ...form, createdAt: nowIso() }, ...notes]);
    setForm({ title: "", content: "" });
    setEditing(null);
    setView(null);
  };
  const visible = notes.filter((note) => `${note.title} ${note.content}`.toLowerCase().includes(search.toLowerCase()));

  if (view === "new" || view === "edit") {
    return <section className="fade-in stack"><div className="section-head left"><button className="btn-ghost" onClick={() => { setView(null); setEditing(null); }}>Back</button><h2>{editing ? "Edit Note" : "New Note"}</h2></div><div className="glass2 note-editor"><input className="input title-input" placeholder="Note title..." value={form.title} onChange={(e) => setForm((next) => ({ ...next, title: e.target.value }))} /><textarea className="input" rows="10" placeholder="Write your notes here..." value={form.content} onChange={(e) => setForm((next) => ({ ...next, content: e.target.value }))} /><button className="btn-primary" onClick={saveNote}>Save</button></div></section>;
  }

  if (view?.id) {
    const note = notes.find((item) => item.id === view.id);
    if (!note) return null;
    return <section className="fade-in stack"><div className="section-head left"><button className="btn-ghost" onClick={() => setView(null)}>Back</button><h2>{note.title}</h2><button className="btn-ghost" onClick={() => { setForm({ title: note.title, content: note.content }); setEditing(note.id); setView("edit"); }}>Edit</button><button className="btn-ghost danger-text" onClick={() => { save(notes.filter((item) => item.id !== note.id)); setView(null); }}>Delete</button></div><article className="glass2 note-view"><small>{fmt(note.createdAt)}</small><p>{note.content}</p></article></section>;
  }

  return (
    <section className="fade-in stack">
      <div className="section-head"><h2>Notes</h2><button className="btn-primary" onClick={() => setView("new")}>+ New Note</button></div>
      <input className="input" placeholder="Search notes..." value={search} onChange={(e) => setSearch(e.target.value)} />
      {visible.length === 0 ? <p>Create your first note.</p> : <div className="notes-grid">{visible.map((note) => <article className="card note-card" key={note.id} onClick={() => setView({ id: note.id })}><h3>{note.title}</h3><p>{note.content}</p><small>{fmt(note.createdAt)}</small></article>)}</div>}
    </section>
  );
}

// تعديل الـ الـ Pomodoro المظبوط لمنع التعليق والـ NaN والتحقق الآمن من الفراغات
function Pomodoro({ settings, setSettings, focusStats, setFocusStats, setGardenState }) {
  const [phase, setPhase] = useState("focus");
  const [time, setTime] = useState(() => settings.focus * 60);
  const [running, setRunning] = useState(false);
  const [completedSessions, setCompletedSessions] = useState(0);
  const settingsRef = useRef(settings);
  const phaseRef = useRef(phase);
  const completedRef = useRef(completedSessions);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    completedRef.current = completedSessions;
  }, [completedSessions]);

  const currentTotal = Math.max(60, (phase === "focus" ? settings.focus : settings.break) * 60);
  const phaseProgress = Math.min(1, Math.max(0, (currentTotal - time) / currentTotal));
  const radius = 84;
  const circumference = 2 * Math.PI * radius;

  const persistSettings = (nextSettings) => {
    const clean = safeFocusSettings(nextSettings);
    setSettings(clean);
    setRunning(false);
    setPhase("focus");
    setCompletedSessions(0);
    completedRef.current = 0;
    setTime(clean.focus * 60);
  };

  const resetTimer = () => {
    setRunning(false);
    setPhase("focus");
    setCompletedSessions(0);
    completedRef.current = 0;
    setTime(settings.focus * 60);
  };

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => {
      setTime((current) => {
        if (current > 1) return current - 1;
        const activeSettings = settingsRef.current;
        const activePhase = phaseRef.current;
        if (activePhase === "focus") {
          const nextCompleted = completedRef.current + 1;
          completedRef.current = nextCompleted;
          setCompletedSessions(nextCompleted);
          const nextStats = applyFocusSession(focusStats, activeSettings.focus);
          setFocusStats(nextStats);
          if (setGardenState) {
            setGardenState(safeGarden({ minutes: nextStats.totalMinutes, sessionsCompleted: nextStats.sessionsCompleted }));
          }
          if (nextCompleted >= activeSettings.sessions) {
            setRunning(false);
            phaseRef.current = "focus";
            setPhase("focus");
            return activeSettings.focus * 60;
          }
          phaseRef.current = "break";
          setPhase("break");
          return activeSettings.break * 60;
        }
        phaseRef.current = "focus";
        setPhase("focus");
        return activeSettings.focus * 60;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, setFocusStats, setGardenState]);

  // دالة الفحص الذكي لمنع التجميد أثناء مسح وإعادة كتابة الأرقام يدوياً
  const handleInputChange = (field, val) => {
    if (val === "") {
      setSettings(prev => ({ ...prev, [field]: "" }));
      return;
    }
    const num = Math.round(Number(val));
    if (!isNaN(num) && num > 0) {
      persistSettings({ ...settings, [field]: num });
    }
  };

  return (
    <section className="fade-in focus-studio">
      <div className="section-head">
        <div><h2>Pomodoro</h2><p>Minimal and stable. Fixed manual input tracking.</p></div>
      </div>
      <div className="focus-grid">
        <article className="glass focus-panel">
          <div className="focus-form">
            <label>Focus min
              <input className="input" type="number" value={settings.focus} min="1" max="180" onChange={(e) => handleInputChange("focus", e.target.value)} />
            </label>
            <label>Break min
              <input className="input" type="number" value={settings.break} min="1" max="60" onChange={(e) => handleInputChange("break", e.target.value)} />
            </label>
            <label>Sessions
              <input className="input" type="number" value={settings.sessions} min="1" max="12" onChange={(e) => handleInputChange("sessions", e.target.value)} />
            </label>
          </div>
          <div className="clock premium-clock">
            <svg width="220" height="220">
              <circle cx="110" cy="110" r={radius} />
              <circle cx="110" cy="110" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - phaseProgress)} />
            </svg>
            <strong>{String(Math.floor((Number(time) || 0) / 60)).padStart(2, "0")}:{String((Number(time) || 0) % 60).padStart(2, "0")}</strong>
            <span>{phase} · session {Math.min(completedSessions + 1, Number(settings.sessions) || 1)}/{Number(settings.sessions) || 1}</span>
          </div>
          <div className="focus-actions">
            <button className="btn-primary" onClick={() => setRunning(true)} disabled={running || !settings.focus}>Start</button>
            <button className="btn-ghost" onClick={() => setRunning(false)} disabled={!running}>Pause</button>
            <button className="btn-ghost" onClick={resetTimer}>Reset</button>
          </div>
        </article>
        <article className="glass pomodoro-status">
          <span>Core timer</span>
          <h3>{running ? (phase === "focus" ? "Focused" : "On Break") : "Ready"}</h3>
          <p>{settings.focus || 0} min focus, {settings.break || 0} min break, {settings.sessions || 0} planned sessions.</p>
          <strong>{completedSessions}/{settings.sessions || 0} sessions completed this run</strong>
        </article>
      </div>
    </section>
  );
}

function Empty({ title }) {
  return <div className="empty-state"><p>{title}</p></div>;
}

function App() {
  const [user, setUser] = useState(() => store.get("c_u"));
  const [view, setView] = useState("dashboard");
  const [authMode, setAuthMode] = useState("login");

  const [tasks, setTasks] = useState(() => store.get(user ? cloudKey(user.id, "tasks") : "masari_tasks", defaultTasks));
  const [notes, setNotes] = useState(() => store.get(user ? cloudKey(user.id, "notes") : "masari_notes", defaultNotes));
  const [focusSettings, setFocusSettings] = useState(() => safeFocusSettings(store.get(user ? cloudKey(user.id, focusSettingsKey) : "masari_focus_settings", { focus: 25, break: 5, sessions: 4 })));
  const [focusStats, setFocusStats] = useState(() => safeFocusStats(store.get(user ? cloudKey(user.id, focusStatsKey) : "masari_focus_stats", defaultFocusStats)));
  const [gardenState, setGardenState] = useState(() => safeGarden(store.get(user ? cloudKey(user.id, focusGardenKey) : "masari_focus_garden")));

  useEffect(() => {
    store.set("c_u", user);
    if (!user) {
      setTasks(safeTasks(store.get("masari_tasks", defaultTasks)));
      setNotes(safeNotes(store.get("masari_notes", defaultNotes)));
      setFocusSettings(safeFocusSettings(store.get("masari_focus_settings", { focus: 25, break: 5, sessions: 4 })));
      setFocusStats(safeFocusStats(store.get("masari_focus_stats", defaultFocusStats)));
      setGardenState(safeGarden(store.get("masari_focus_garden")));
    }
  }, [user]);

  useEffect(() => { if (user) store.set(cloudKey(user.id, "tasks"), tasks); else store.set("masari_tasks", tasks); }, [tasks, user]);
  useEffect(() => { if (user) store.set(cloudKey(user.id, "notes"), notes); else store.set("masari_notes", notes); }, [notes, user]);
  useEffect(() => { if (user) store.set(cloudKey(user.id, focusSettingsKey), focusSettings); else store.set("masari_focus_settings", focusSettings); }, [focusSettings, user]);
  useEffect(() => { if (user) store.set(cloudKey(user.id, focusStatsKey), focusStats); else store.set("masari_focus_stats", focusStats); }, [focusStats, user]);
  useEffect(() => { if (user) store.set(cloudKey(user.id, focusGardenKey), gardenState); else store.set("masari_focus_garden", gardenState); }, [gardenState, user]);

  if (!user) {
    if (view === "landing") return <Landing onStart={() => setAuthMode("signup")} onLogin={() => setAuthMode("login")} />;
    return <Auth mode={authMode} onToggle={() => setAuthMode(authMode === "login" ? "signup" : "login")} onSuccess={(u) => { setUser(u); setView("dashboard"); }} />;
  }

  return (
    <div className="app-layout">
      <Sidebar active={view} onNav={setView} user={user} onLogout={() => setUser(null)} />
      <main className="content">
        {view === "dashboard" && <Dashboard user={user} onNav={setView} tasks={tasks} notes={notes} focusStats={focusStats} />}
        {view === "tasks" && <Tasks tasks={tasks} setTasks={setTasks} />}
        {view === "notes" && <Notes notes={notes} setNotes={setNotes} />}
        {view === "pomodoro" && <Pomodoro settings={focusSettings} setSettings={setFocusSettings} focusStats={focusStats} setFocusStats={setFocusStats} setGardenState={setGardenState} />}
        {["garden", "flight", "candle", "ai", "evolution", "profile"].includes(view) && (
          <section className="fade-in panel glass">
            <h2>{view.toUpperCase()} Component</h2>
            <p>This module is under construction or separated in your current architecture. Core systems are running smoothly.</p>
          </section>
        )}
      </main>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<App />);
}

