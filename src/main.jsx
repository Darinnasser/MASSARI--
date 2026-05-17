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
      // Local storage can be disabled in private browsing.
    }
  },
  del: (key) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`[storage:del:${key}]`, error);
      // Local storage can be disabled in private browsing.
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
    { icon: "âœ“", color: "#7c3aed", title: "Smart Tasks", text: "Priority task management" },
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
        seedData(user.id);
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
        <div><p>{greeting}</p><h2>{user.name || "Student"}</h2><strong>{user.level} آ· Let's crush your goals today.</strong></div>
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
      <div className="stack small">{filtered.length === 0 ? <Empty title="No tasks found." /> : filtered.map((task) => <div className="glass task-item" key={task.id} style={{ borderLeftColor: priorityColor[task.priority] }}><button className={`check ${task.isCompleted ? "on" : ""}`} onClick={() => save(tasks.map((item) => item.id === task.id ? { ...item, isCompleted: !item.isCompleted } : item))}>âœ“</button><p className={task.isCompleted ? "done" : ""}>{task.title}</p><span className="tag" style={{ background: priorityBg[task.priority], color: priorityColor[task.priority] }}>{task.priority}</span><small>{fmt(task.createdAt)}</small><button className="icon-btn" onClick={() => { setForm({ title: task.title, priority: task.priority }); setEditing(task.id); setShowForm(true); }}>Edit</button><button className="icon-btn danger-text" onClick={() => save(tasks.filter((item) => item.id !== task.id))}>Delete</button></div>)}</div>
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
      {visible.length === 0 ? <Empty title={search ? "No notes match." : "Create your first note."} /> : <div className="notes-grid">{visible.map((note) => <article className="card note-card" key={note.id} onClick={() => setView({ id: note.id })}><h3>{note.title}</h3><p>{note.content}</p><small>{fmt(note.createdAt)}</small></article>)}</div>}
    </section>
  );
}

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
          setGardenState(safeGarden({ minutes: nextStats.totalMinutes, sessionsCompleted: nextStats.sessionsCompleted }));
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

  return (
    <section className="fade-in focus-studio">
      <div className="section-head">
        <div><h2>Pomodoro</h2><p>Minimal and stable. Shared productivity modules read completed focus sessions without owning this timer.</p></div>
      </div>
      <div className="focus-grid">
        <article className="glass focus-panel">
          <div className="focus-form">
            <label>Focus min<input className="input" type="number" value={settings.focus} min="1" max="180" onChange={(e) => persistSettings({ ...settings, focus: e.target.value })} /></label>
            <label>Break min<input className="input" type="number" value={settings.break} min="1" max="60" onChange={(e) => persistSettings({ ...settings, break: e.target.value })} /></label>
            <label>Sessions<input className="input" type="number" value={settings.sessions} min="1" max="12" onChange={(e) => persistSettings({ ...settings, sessions: e.target.value })} /></label>
          </div>
          <div className="clock premium-clock"><svg width="220" height="220"><circle cx="110" cy="110" r={radius} /><circle cx="110" cy="110" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - phaseProgress)} /></svg><strong>{String(Math.floor(time / 60)).padStart(2, "0")}:{String(time % 60).padStart(2, "0")}</strong><span>{phase} · session {Math.min(completedSessions + 1, settings.sessions)}/{settings.sessions}</span></div>
          <div className="focus-actions">
            <button className="btn-primary" onClick={() => setRunning(true)} disabled={running}>Start</button>
            <button className="btn-ghost" onClick={() => setRunning(false)} disabled={!running}>Pause</button>
            <button className="btn-ghost" onClick={resetTimer}>Reset</button>
          </div>
        </article>
        <article className="glass pomodoro-status">
          <span>Core timer</span>
          <h3>{running ? (phase === "focus" ? "Focused" : "On Break") : "Ready"}</h3>
          <p>{settings.focus} min focus, {settings.break} min break, {settings.sessions} planned sessions. Garden, Flight, and Candle are now separate modules.</p>
          <strong>{completedSessions}/{settings.sessions} sessions completed this run</strong>
        </article>
      </div>
    </section>
  );
}

function GardenCard({ trees, stage, minutes, full = false, sessions = 0, progress = 0 }) {
  const stageClass = stage.replace(" ", "-");
  return (
    <article className={`glass garden-card ${full ? "full" : ""}`}>
      <div className="garden-sky">
        <div className={`plant ${stageClass}`}><span /><b /><i /></div>
        {[...Array(Math.min(trees, 8))].map((_, index) => <div className="mini-tree" style={{ left: `${10 + index * 10}%` }} key={index}><span /><b /></div>)}
        <div className="garden-progress"><i style={{ width: `${Math.max(12, progress * 100)}%` }} /></div>
      </div>
      <div className="garden-meta">
        <h3>Focus Garden</h3>
        <p>{minutes} focused minutes · {trees} tree{trees === 1 ? "" : "s"} grown</p>
        <strong>{sessions} completed focus sessions</strong>
        <strong>Current growth: {stage}</strong>
      </div>
    </article>
  );
}

function fmtDuration(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function CandleVisual({ phase, running, time, preset, onPresetChange, waxHeight, progress }) {
  return (
    <article className="glass candle-mode">
      <div className="candle-copy">
        <h3>Candle Focus</h3>
        <p>Ambient visual mode. It stays separate from Pomodoro timing and focuses only on atmosphere.</p>
      </div>
      <div className="preset-row">{[30, 60, 90, 120].map((value) => <button key={value} className={preset === value ? "btn-primary" : "btn-ghost"} onClick={() => onPresetChange(value)}>{value} min</button>)}</div>
      <div className="candle-scene">
        <div className="flame" />
        <div className="wick" />
        <div className="candle"><div className="wax" style={{ height: `${waxHeight}%` }} /></div>
        <div className="candle-time">{String(Math.floor(time / 60)).padStart(2, "0")}:{String(time % 60).padStart(2, "0")}</div>
      </div>
      <div className="candle-stats">
        <span>{running ? "Actively melting" : "Waiting for focus time"}</span>
        <span>{phase === "focus" ? "Focus phase" : "Break phase"}</span>
        <span>{Math.round(progress * 100)}% visual melt</span>
      </div>
    </article>
  );
}

function FocusFlight({ flight, progress, running, time, totalFocusSeconds, onUpdate }) {
  const presetTrip = flightTrips.find((item) => item.id === flight.tripId) || flightTrips[0];
  const trip = {
    ...presetTrip,
    from: flight.origin || presetTrip.from,
    to: flight.destination || presetTrip.to,
    start: flightCities[flight.origin || presetTrip.from] || flightCities.Cairo,
    end: flightCities[flight.destination || presetTrip.to] || flightCities.Amsterdam
  };
  const x = trip.start[0] + (trip.end[0] - trip.start[0]) * progress;
  const y = trip.start[1] + (trip.end[1] - trip.start[1]) * progress;
  const remaining = Math.max(0, totalFocusSeconds - time);
  const eta = fmtDuration(remaining);
  const distanceRemaining = Math.max(0, Math.round((trip.distance || 3000) * (1 - progress)));
  const status = progress >= 1 ? "Arrived" : running ? "Flying" : progress > 0 ? "Paused" : "Boarding";
  const cityNames = Object.keys(flightCities);

  return (
    <article className="glass flight-card">
      <div className="flight-head">
        <div>
          <span>Focus Flight</span>
          <h3>{trip.label}</h3>
        </div>
        <strong>{Math.round(progress * 100)}%</strong>
      </div>
      <div className="flight-controls">
        <label>Hours<input className="input" type="number" min="0" max="12" value={flight.hours} onChange={(e) => onUpdate({ hours: e.target.value, arrived: false })} /></label>
        <label>Minutes<input className="input" type="number" min="0" max="59" step="5" value={flight.minutes} onChange={(e) => onUpdate({ minutes: e.target.value, arrived: false })} /></label>
        <label>Preset route<select className="input" value={flight.tripId} onChange={(e) => {
          const nextTrip = flightTrips.find((item) => item.id === e.target.value) || flightTrips[0];
          onUpdate({ tripId: nextTrip.id, origin: nextTrip.from, destination: nextTrip.to, arrived: false });
        }}>{flightTrips.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Origin<select className="input" value={trip.from} onChange={(e) => onUpdate({ origin: e.target.value, arrived: false })}>{cityNames.map((city) => <option key={city}>{city}</option>)}</select></label>
        <label>Destination<select className="input" value={trip.to} onChange={(e) => onUpdate({ destination: e.target.value, arrived: false })}>{cityNames.map((city) => <option key={city}>{city}</option>)}</select></label>
      </div>
      <div className="flight-map">
        <div className="stars" />
        <div className="cloud c1" />
        <div className="cloud c2" />
        <svg className="world-map" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path className="land l1" d="M8,37 C14,20 32,18 39,32 C47,35 42,52 31,55 C18,60 5,52 8,37Z" />
          <path className="land l2" d="M38,31 C51,20 65,27 64,41 C74,44 74,61 60,63 C48,64 37,54 39,43Z" />
          <path className="land l3" d="M66,27 C80,18 94,28 91,43 C86,55 72,54 66,44Z" />
          <path className="land l4" d="M50,66 C62,60 75,66 73,80 C63,86 50,79 50,66Z" />
        </svg>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <path className="flight-route-shadow" d={`M ${trip.start[0]} ${trip.start[1]} Q 50 18 ${trip.end[0]} ${trip.end[1]}`} />
          <path className="flight-route" d={`M ${trip.start[0]} ${trip.start[1]} Q 50 18 ${trip.end[0]} ${trip.end[1]}`} />
          <circle cx={trip.start[0]} cy={trip.start[1]} r="1.6" />
          <circle cx={trip.end[0]} cy={trip.end[1]} r="1.6" />
        </svg>
        <div className="city from" style={{ left: `${trip.start[0]}%`, top: `${trip.start[1]}%` }}>{trip.from}</div>
        <div className="city to" style={{ left: `${trip.end[0]}%`, top: `${trip.end[1]}%` }}>{trip.to}</div>
        <div className={`plane ${running ? "flying" : ""}`} style={{ left: `${x}%`, top: `${y}%` }}>✈</div>
        {progress >= 1 && <div className="arrival">Flight Arrived +{flight.xp} XP</div>}
      </div>
      <div className="flight-meta">
        <span>Time remaining {eta}</span>
        <span>{trip.from} to {trip.to}</span>
        <span>{distanceRemaining.toLocaleString()} km left</span>
        <span>Elapsed {fmtDuration(time)}</span>
        <span>Status: {status}</span>
        <span>{flight.xp} XP</span>
      </div>
      <blockquote className="glass">This route can run standalone or follow shared Pomodoro progress in sync mode. It never drives the Pomodoro timer.</blockquote>
    </article>
  );
}

function FocusGardenPage({ stats, garden }) {
  const minutes = Math.max(garden?.minutes || 0, stats.totalMinutes);
  const sessionsCompleted = Math.max(garden?.sessionsCompleted || 0, stats.sessionsCompleted);
  const trees = Math.floor(minutes / 60);
  const progress = Math.max(0, minutes / 60 - trees);
  const stage = minutes < 20 ? "seed" : minutes < 60 ? "small plant" : minutes < 120 ? "young tree" : "full tree";

  return (
    <section className="fade-in stack">
      <div className="section-head">
        <div><h2>Focus Garden</h2><p>Your focus sessions grow the garden. This page reads shared stats and stays isolated from the Pomodoro timer logic.</p></div>
      </div>
      <GardenCard trees={trees} stage={stage} minutes={minutes} full sessions={sessionsCompleted} progress={progress} />
      <div className="dashboard-grid">
        <article className="glass panel garden-stats"><h3>Calm Progress</h3><p>Current streak <strong>{stats.streak} day{stats.streak === 1 ? "" : "s"}</strong></p><p>Longest streak <strong>{stats.longestStreak} day{stats.longestStreak === 1 ? "" : "s"}</strong></p><p>Focus XP <strong>{stats.xp}</strong></p></article>
        <article className="glass panel garden-stats"><h3>Session History</h3>{stats.history.length === 0 ? <p>No completed Pomodoro sessions yet.</p> : <div className="history-list">{stats.history.slice(0, 8).map((entry) => <div className="history-row" key={entry.id}><span>{fmt(entry.date)}</span><strong>{entry.minutes} min</strong><b>+{entry.xp} XP</b></div>)}</div>}</article>
      </div>
    </section>
  );
}

function FocusFlightPage({ stats, flight, setFlight }) {

  useEffect(() => {
    if (flight.mode !== "solo" || flight.status !== "flying") return undefined;
    const id = setInterval(() => {
      setFlight((current) => {
        if (current.mode !== "solo" || current.status !== "flying") return current;
        const elapsedSeconds = Math.min(current.totalSeconds, current.elapsedSeconds + 1);
        const arrived = elapsedSeconds >= current.totalSeconds;
        const next = safeFlight({
          ...current,
          elapsedSeconds,
          status: arrived ? "arrived" : "flying",
          arrived,
          xp: arrived && !current.arrived ? current.xp + Math.max(10, Math.round(current.totalSeconds / 360)) : current.xp
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [flight.mode, flight.status]);

  const syncElapsedSeconds = Math.max(0, (stats.totalMinutes - flight.syncStartMinutes) * 60);
  const syncProgress = Math.min(1, syncElapsedSeconds / Math.max(60, flight.totalSeconds));
  const soloProgress = Math.min(1, flight.elapsedSeconds / Math.max(60, flight.totalSeconds));
  const progress = flight.mode === "sync" ? syncProgress : soloProgress;
  const elapsed = flight.mode === "sync" ? syncElapsedSeconds : flight.elapsedSeconds;
  const syncedRunning = flight.mode === "sync" && progress > 0 && progress < 1;

  const updateFlight = (patch) => {
    setFlight((current) => {
      return safeFlight({ ...current, ...patch });
    });
  };

  return (
    <section className="fade-in stack">
      <div className="section-head">
        <div><h2>Focus Flight</h2><p>Run a standalone travel-style session or sync the route to shared Pomodoro progress. The route reads focus progress and stays stable on its own page.</p></div>
        <div className="mode-tabs">{["solo", "sync"].map((mode) => <button key={mode} className={flight.mode === mode ? "active" : ""} onClick={() => updateFlight({ mode })}>{mode}</button>)}</div>
      </div>
      <FocusFlight flight={flight} progress={progress} running={flight.mode === "solo" ? flight.status === "flying" : syncedRunning} time={elapsed} totalFocusSeconds={flight.totalSeconds} onUpdate={updateFlight} />
      <div className="focus-actions">
        {flight.mode === "solo" ? <>
          <button className="btn-primary" onClick={() => updateFlight({ status: "flying", elapsedSeconds: 0, arrived: false })} disabled={flight.status === "flying"}>{flight.elapsedSeconds > 0 ? "Restart Solo Session" : "Start Solo Session"}</button>
          <button className="btn-ghost" onClick={() => updateFlight({ status: "paused" })} disabled={flight.status !== "flying"}>Pause</button>
          <button className="btn-ghost" onClick={() => updateFlight({ status: "flying" })} disabled={flight.status !== "paused"}>Resume</button>
          <button className="btn-ghost" onClick={() => updateFlight({ status: "ready", elapsedSeconds: 0, arrived: false })}>Reset</button>
        </> : <>
          <button className="btn-primary" onClick={() => updateFlight({ syncStartMinutes: stats.totalMinutes, arrived: false })}>Start Synced Route</button>
          <button className="btn-ghost" onClick={() => updateFlight({ syncStartMinutes: stats.totalMinutes, arrived: false })}>Reset Sync Baseline</button>
        </>}
      </div>
    </section>
  );
}

function CandleFocusPage({ prefs, setPrefs }) {
  const [previewActive, setPreviewActive] = useState(false);
  const [previewTime, setPreviewTime] = useState(prefs.previewSeconds);

  useEffect(() => {
    if (!previewActive) return undefined;
    const id = setInterval(() => {
      setPreviewTime((current) => current > 1 ? current - 1 : prefs.preset * 60);
    }, 1000);
    return () => clearInterval(id);
  }, [prefs.preset, previewActive]);

  const updatePrefs = (patch) => {
      setPrefs((current) => {
        const next = safeCandleFocus({ ...current, ...patch, previewSeconds: patch.preset ? patch.preset * 60 : current.previewSeconds });
        if (patch.preset) setPreviewTime(next.preset * 60);
        return next;
      });
  };

  const progress = Math.min(1, (prefs.preset * 60 - previewTime) / Math.max(60, prefs.preset * 60));
  const waxHeight = Math.max(8, 100 - progress * 92);

  return (
    <section className="fade-in stack">
      <div className="section-head">
        <div><h2>Candle Focus</h2><p>A dedicated ambient focus room with glow, presets, and optional sound mood. It is visual-only and never touches shared timers.</p></div>
      </div>
      <article className="glass candle-shell" style={{ boxShadow: `0 24px 80px rgba(245,158,11,${prefs.glow / 500})` }}>
        <CandleVisual phase="focus" running={previewActive} time={previewTime} preset={prefs.preset} onPresetChange={(value) => updatePrefs({ preset: value })} waxHeight={waxHeight} progress={progress} />
        <div className="candle-page-controls">
          <label>Glow<input className="input" type="range" min="20" max="100" value={prefs.glow} onChange={(e) => updatePrefs({ glow: e.target.value })} /></label>
          <label>Ambience<select className="input" value={prefs.ambience} onChange={(e) => updatePrefs({ ambience: e.target.value })}><option>Library hush</option><option>Night studio</option><option>Rain window</option></select></label>
          <label className="detail-toggle"><input type="checkbox" checked={prefs.soundOn} onChange={(e) => updatePrefs({ soundOn: e.target.checked })} />Ambient sounds</label>
          <div className="focus-actions">
            <button className="btn-primary" onClick={() => setPreviewActive(true)} disabled={previewActive}>Start Preview</button>
            <button className="btn-ghost" onClick={() => setPreviewActive(false)} disabled={!previewActive}>Pause</button>
            <button className="btn-ghost" onClick={() => { setPreviewActive(false); setPreviewTime(prefs.preset * 60); }}>Reset</button>
          </div>
        </div>
      </article>
    </section>
  );
}

function Profile({ user, onUpdate }) {
  const [form, setForm] = useState({ name: user.name, email: user.email, level: user.level, age: user.age, gender: user.gender });
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setForm({ name: user.name, email: user.email, level: user.level, age: user.age, gender: user.gender });
  }, [user]);
  const save = () => {
    onUpdate({ ...user, ...form });
    setEditing(false);
  };
  return (
    <section className="fade-in stack profile">
      <h2>Academic Profile</h2>
      <div className="glass2 profile-head"><div className="avatar big">{user.name?.[0]?.toUpperCase() || "S"}</div><div><h3>{user.name}</h3><strong>{user.level}</strong><p>{user.email}</p></div></div>
      {editing ? <div className="glass2 form-stack">{["name", "age"].map((key) => <input className="input" key={key} value={form[key] || ""} onChange={(e) => setForm((next) => ({ ...next, [key]: e.target.value }))} />)}<select className="input" value={form.level} onChange={(e) => setForm((next) => ({ ...next, level: e.target.value }))}>{["Freshman", "Sophomore", "Junior", "Senior", "Graduate"].map((level) => <option key={level}>{level}</option>)}</select><select className="input" value={form.gender} onChange={(e) => setForm((next) => ({ ...next, gender: e.target.value }))}><option>Male</option><option>Female</option><option>Other</option></select><button className="btn-primary" onClick={save}>Save</button></div> : <div className="glass info-list">{[["Full Name", user.name], ["Email", user.email], ["Level", user.level], ["Age", user.age], ["Gender", user.gender], ["Member Since", fmt(user.createdAt)]].map(([label, value]) => <p key={label}><span>{label}</span><strong>{value || "-"}</strong></p>)}<button className="btn-ghost" onClick={() => setEditing(true)}>Edit Profile</button></div>}
      <div className="glass cloud"><strong>Account Status</strong><p>Welcome, {user.name}! You're logged in as a {user.level} level student. Your profile data is securely stored and synchronized across all Masari features.</p></div>
    </section>
  );
}

const promptChips = [
  { label: "Summarize this file", task: "summary" },
  { label: "Explain the hard parts", task: "hard" },
  { label: "Generate MCQs", task: "quiz" },
  { label: "Flashcards", task: "flashcards" },
  { label: "Make a study plan", task: "study-plan" },
  { label: "Extract key points", task: "key-points" }
];

const qualityModes = [
  { id: "fast", label: "Fast Mode", hint: "Stable, shorter, lower tokens" },
  { id: "study", label: "Study Mode", hint: "Balanced quality for normal study" },
  { id: "deep", label: "Deep Tutor Mode", hint: "Best quality, slower, more tokens" }
];

const buildAiCacheId = ({ documentId, task, qualityMode, message, summaryMode, quizDifficulty, quizCount }) => [
  documentId || "none",
  task || "general",
  qualityMode || "study",
  summaryMode || "detailed",
  quizDifficulty || "mixed",
  quizCount || 10,
  String(message || "").trim().toLowerCase()
].join("::");
const quotaMessage = "Daily AI limit reached. Try again later.";
const largeDocumentCharThreshold = 36000;
const largeDocumentChunkThreshold = 10;
const detectDocumentTask = (message) => {
  const text = String(message || "").toLowerCase();
  if (/flashcard|flash card|cards/.test(text)) return "flashcards";
  if (/mcq|multiple choice|quiz|questions?/.test(text)) return "quiz";
  if (/hard|difficult|confusing|explain/.test(text)) return "hard";
  if (/study plan|schedule|plan/.test(text)) return "study-plan";
  if (/key points?|takeaways?|extract/.test(text)) return "key-points";
  if (/summar|overview/.test(text)) return "summary";
  return "general";
};
const isLargeAiDocument = (document) => Boolean(document && ((document.characters || 0) > largeDocumentCharThreshold || (document.chunks || 0) > largeDocumentChunkThreshold));
const mergeDocumentState = (current, incoming) => {
  if (!incoming) return current;
  return {
    ...(current || {}),
    ...incoming,
    chunkMeta: Array.isArray(incoming.chunkMeta) ? incoming.chunkMeta : current?.chunkMeta || [],
    text: typeof incoming.text === "string" ? incoming.text : current?.text || "",
    pageCount: Number.isFinite(Number(incoming.pageCount)) ? Number(incoming.pageCount) : current?.pageCount || 0
  };
};
const cleanTopicLabel = (value, fallback = "Review this concept") => {
  const text = String(value || "")
    .replace(/\b(page\s+\d+(\s+of\s+\d+)?)\b/gi, " ")
    .replace(/\bcopyright\b.*$/gi, " ")
    .replace(/\bcisco\b.*$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text && text.length >= 3 ? text.slice(0, 90) : fallback;
};
const buildLoadingPlan = ({ task, chunkCount = 1, detailMode = false, large = false }) => {
  if (task === "summary") {
    const steps = Math.max(2, Math.min(6, Math.ceil(chunkCount / 2)));
    return ["Analyzing lecture...", ...Array.from({ length: steps }, (_, index) => `Analyzing section ${index + 1}/${steps}`), "Writing study summary..."];
  }
  if (task === "quiz" || task === "mcq") return ["Building high-quality quiz...", "Generating MCQs 1-3...", "Generating MCQs 4-6...", "Continuing remaining sections...", "Merging final quiz set..."];
  if (task === "flashcards") return ["Preparing flashcards...", "Selecting definitions and key rules...", "Generating flashcards 1-5...", "Continuing remaining sections...", "Finishing flashcards..."];
  if (task === "hard") return ["Analyzing lecture...", "Finding difficult sections...", "Explaining the hardest concepts..."];
  if (detailMode) return ["Analyzing lecture...", "Analyzing source sections...", "Building detailed response..."];
  return [large ? "Retrying optimized analysis..." : "Analyzing lecture...", "Selecting relevant chunks...", "Writing response..."];
};

const workspaceTasks = ["summary", "quiz", "flashcards", "study-plan", "hard", "key-points"];
const textWorkspaceTasks = ["summary", "study-plan", "hard", "key-points"];
const workspaceBadge = {
  summary: "Summary",
  quiz: "Quiz",
  flashcards: "Flashcards",
  "study-plan": "Study Plan",
  hard: "Hard Parts",
  "key-points": "Key Points"
};
const workspaceVerb = {
  summary: "Summary",
  quiz: "Quiz",
  flashcards: "Flashcards",
  "study-plan": "Study Plan",
  hard: "Hard Parts",
  "key-points": "Key Points"
};
const isWorkspaceTask = (task) => workspaceTasks.includes(task);
const isTextWorkspaceTask = (task) => textWorkspaceTasks.includes(task);
const fileLabelForTitle = (name) => {
  const clean = String(name || "Uploaded file").trim().replace(/\.[^.]+$/, "");
  return clean || "Uploaded file";
};
const buildWorkspaceTitle = (task, name) => `${workspaceVerb[task] || "Result"} from ${fileLabelForTitle(name)}`;

function AIAssistant({ user, compact = false, tasks = [], notes = [], messages, setMessages }) {
  const [input, setInput] = useState("");
  const [file, setFile] = useState(null);
  const [document, setDocument] = useState(null);
  const [fileStatus, setFileStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [processingFile, setProcessingFile] = useState(false);
  const [quiz, setQuiz] = useState(() => store.get(latestQuizKey, null));
  const [flashcards, setFlashcards] = useState(null);
  const [qualityMode, setQualityMode] = useState("study");
  const [summaryMode, setSummaryMode] = useState("detailed");
  const [quizDifficulty, setQuizDifficulty] = useState("mixed");
  const [quizCount, setQuizCount] = useState(10);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [quotaLimited, setQuotaLimited] = useState(false);
  const [loadingHint, setLoadingHint] = useState("");
  const [retryRequest, setRetryRequest] = useState(null);
  const [resultWorkspace, setResultWorkspace] = useState(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const requestInFlight = useRef(false);
  const cacheRef = useRef(store.get(aiCacheKey, {}));
  const scrollRef = useRef(null);
  const shouldStickToBottom = useRef(true);
  const pendingAutoScroll = useRef(false);
  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));

  useEffect(() => {
    setQuizCount((current) => {
      const allowed = qualityMode === "fast" ? [5] : qualityMode === "deep" ? [5, 10, 15] : [5, 10];
      if (allowed.includes(current)) return current;
      return qualityMode === "fast" ? 5 : qualityMode === "deep" ? 15 : 10;
    });
  }, [qualityMode]);

  const scrollToLatest = useCallback((behavior = "auto") => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    shouldStickToBottom.current = true;
    setShowJumpToLatest(false);
  }, []);

  const queueAutoScroll = useCallback((force = false) => {
    pendingAutoScroll.current = force || shouldStickToBottom.current;
  }, []);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
    shouldStickToBottom.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }, []);

  useEffect(() => {
    if (pendingAutoScroll.current) {
      scrollToLatest("auto");
      pendingAutoScroll.current = false;
    }
  }, [messages.length, resultWorkspace?.id, scrollToLatest]);

  const closeWorkspace = useCallback(() => {
    setResultWorkspace(null);
  }, []);

  const openWorkspace = useCallback((nextWorkspace) => {
    setResultWorkspace({ id: uid(), ...nextWorkspace });
    queueAutoScroll(true);
  }, [queueAutoScroll]);

  const renderWorkspaceFromResponse = useCallback((task, reply, nextQuiz, nextFlashcards, fileName) => {
    if (task === "quiz" && nextQuiz) {
      setQuiz(nextQuiz);
      setFlashcards(null);
      openWorkspace({
        type: "quiz",
        badge: workspaceBadge.quiz,
        title: buildWorkspaceTitle("quiz", fileName || nextQuiz.title || "Uploaded file")
      });
      return;
    }
    if (task === "flashcards" && nextFlashcards) {
      setFlashcards(nextFlashcards);
      setQuiz(null);
      openWorkspace({
        type: "flashcards",
        badge: workspaceBadge.flashcards,
        title: buildWorkspaceTitle("flashcards", fileName || nextFlashcards.title || "Uploaded file")
      });
      return;
    }
    if (isTextWorkspaceTask(task) && reply) {
      setQuiz(null);
      setFlashcards(null);
      openWorkspace({
        type: task,
        badge: workspaceBadge[task],
        title: buildWorkspaceTitle(task, fileName),
        content: reply
      });
    }
  }, [openWorkspace]);

  const writeCache = (cacheId, entry) => {
    cacheRef.current = {
      ...cacheRef.current,
      [cacheId]: { ...entry, cachedAt: Date.now() }
    };
    store.set(aiCacheKey, cacheRef.current);
  };

  const uploadDocument = async (selectedFile) => {
    if (!selectedFile) {
      setFile(null);
      setDocument(null);
      setResultWorkspace(null);
      setQuiz(null);
      setFlashcards(null);
      setFileStatus("");
      return;
    }
    if (selectedFile.size > 8 * 1024 * 1024) {
      setFileStatus(`${selectedFile.name}: file is too large for light mode upload`);
      setMessages((next) => [...next, { role: "assistant", text: "Please upload a file smaller than 8 MB so I can extract it reliably without wasting AI quota." }]);
      return;
    }
    setFile(selectedFile);
    setDocument(null);
    setQuotaLimited(false);
    setResultWorkspace(null);
    setQuiz(null);
    setFlashcards(null);
    setProcessingFile(true);
    setFileStatus(`${selectedFile.name}: extracting readable text...`);
    const form = new FormData();
    form.append("file", selectedFile);
    try {
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed.");
      setDocument((current) => mergeDocumentState(current, data.document));
      setFileStatus(data.statusLabel || "File ready for analysis");
      queueAutoScroll(true);
      setMessages((next) => [...next, {
        role: "assistant",
        text: `I extracted ${data.document.characters.toLocaleString()} readable characters from ${data.document.name}${data.document.pageCount ? ` across ${data.document.pageCount} page${data.document.pageCount === 1 ? "" : "s"}` : ""}. The file is ready for summary, quiz, flashcards, hard-part explanations, study plans, and key points without re-uploading.`
      }]);
    } catch (error) {
      setFileStatus(`${selectedFile.name}: processing failed`);
      console.error("[ai:upload]", error);
      setMessages((next) => [...next, { role: "assistant", text: "I could not process that file safely. Try a smaller PDF, DOCX, or TXT file." }]);
    } finally {
      setProcessingFile(false);
    }
  };

  const send = useCallback(async (override, task = null) => {
    const message = (override || input).trim();
    if (!message || loading || processingFile || requestInFlight.current) return;
    const effectiveTask = task || detectDocumentTask(message);
    const cacheId = buildAiCacheId({
      documentId: document?.id,
      task,
      qualityMode,
      message,
      summaryMode,
      quizDifficulty,
      quizCount
    });
      const cached = cacheRef.current[cacheId];
    if (cached) {
      setQuotaLimited(false);
      setRetryRequest(null);
      const sourceName = document?.name || file?.name || "Uploaded file";
      renderWorkspaceFromResponse(effectiveTask, cached.reply, cached.quiz, cached.flashcards, sourceName);
      if (cached.quiz) store.set(latestQuizKey, cached.quiz);
      queueAutoScroll(true);
      setMessages((next) => [...next, { role: "user", text: message }, { role: "assistant", text: cached.reply }]);
      setInput("");
      setFileStatus(document ? "File ready for analysis" : fileStatus);
      setLoadingHint("");
      return;
    }
    requestInFlight.current = true;
    setInput("");
    setLoading(true);
    setQuotaLimited(false);
    if (isWorkspaceTask(effectiveTask)) {
      setResultWorkspace(null);
      if (effectiveTask !== "quiz") setQuiz(null);
      if (effectiveTask !== "flashcards") setFlashcards(null);
    }
    const largeDocument = isLargeAiDocument(document);
    const loadingPlan = buildLoadingPlan({ task: effectiveTask, chunkCount: document?.chunks || 1, detailMode: qualityMode === "deep", large: largeDocument });
    setLoadingHint(loadingPlan[0]);
    setFileStatus(document ? (effectiveTask === "quiz" ? "Building high-quality quiz..." : effectiveTask === "flashcards" ? "Preparing flashcards..." : effectiveTask === "summary" ? "Writing study summary..." : effectiveTask === "hard" ? "Analyzing lecture..." : effectiveTask === "study-plan" ? "Analyzing lecture..." : effectiveTask === "key-points" ? "Analyzing lecture..." : largeDocument ? "Retrying optimized analysis..." : "Analyzing lecture...") : file ? `${file.name}: attaching file...` : "Sending request...");
    queueAutoScroll(true);
    setMessages((next) => [...next, { role: "user", text: message }]);
    const form = new FormData();
    if (!document && file) form.append("file", file);
    form.append("payload", JSON.stringify({
      message,
      task,
      qualityMode,
      summaryMode,
      quizDifficulty,
      quizCount,
      messages: messages.slice(-4),
      documentId: document?.id,
      user: { name: user.name, level: user.level },
      tasks,
      notes
    }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), qualityMode === "deep" ? 90000 : 60000);
    try {
      const response = await fetch("/api/chat", { method: "POST", body: form, signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed.");
      setCooldownUntil(Date.now() + (qualityMode === "deep" ? aiCooldownMs + 5000 : aiCooldownMs));
      if (data.file) {
        setDocument((current) => mergeDocumentState(current, data.file));
      }
      setFileStatus(data.statusLabel || "File ready for analysis");
      renderWorkspaceFromResponse(effectiveTask, data.reply, data.quiz, data.flashcards, data.file?.name || document?.name || file?.name || "Uploaded file");
      if (data.quiz) store.set(latestQuizKey, data.quiz);
      queueAutoScroll(shouldStickToBottom.current);
      setMessages((next) => [...next, { role: "assistant", text: data.reply }]);
      setRetryRequest(null);
      if (document?.id || data.file?.id) {
        writeCache(cacheId, {
          reply: data.reply,
          quiz: data.quiz || null,
          flashcards: data.flashcards || null,
          statusLabel: data.statusLabel || "File ready for analysis"
        });
      }
    } catch (error) {
      console.error("[ai:chat]", error);
      setCooldownUntil(Date.now() + aiCooldownMs);
      setRetryRequest({ message, task });
      const text = error.name === "AbortError"
        ? "Retrying optimized analysis..."
        : error.message === quotaMessage
          ? quotaMessage
          : cooldownUntil > Date.now()
            ? "Retrying optimized analysis..."
            : largeDocument
              ? "Retrying optimized analysis..."
              : "Partial results ready.";
      setFileStatus(text === quotaMessage ? "AI limit reached, try later" : document ? "File ready for analysis" : file ? `${file.name}: upload or chat failed` : "");
      if (text === quotaMessage) setQuotaLimited(true);
      queueAutoScroll(shouldStickToBottom.current);
      setMessages((next) => [...next, { role: "assistant", text }]);
    } finally {
      clearTimeout(timeout);
      setLoadingHint("");
      requestInFlight.current = false;
      setLoading(false);
    }
  }, [cooldownUntil, document, file, fileStatus, input, loading, messages, processingFile, qualityMode, queueAutoScroll, quizCount, quizDifficulty, renderWorkspaceFromResponse, summaryMode, user]);

  return (
    <section className={`fade-in ai-view ${compact ? "compact-ai" : ""}`}>
      {!compact && <h2>AI Assistant</h2>}
      {quotaLimited && <div className="glass ai-limit-card"><strong>{quotaMessage}</strong><p>Light Mode stays enabled and your uploaded file remains in chat state, so you can try again later without re-uploading.</p></div>}
      <div className="glass ai-scroll-shell" ref={scrollRef} onScroll={handleScroll}>
        <div className="chat-log">
          {messages.map((message, index) => <div className={`chat-line ${message.role}`} key={`${message.role}-${index}`}>{message.role === "assistant" && <Buddy size={32} anim={false} />}<div className={message.role === "user" ? "chat-user" : "chat-ai"}>{message.text}</div></div>)}
        </div>
        <div className={`glass ai-progress ${loadingHint ? "active" : ""}`} aria-hidden={!loadingHint}><strong>{loadingHint || " "}</strong></div>
        <div className={`result-workspace-shell ${resultWorkspace ? "active" : "idle"}`} aria-hidden={!resultWorkspace}>
          {resultWorkspace ? (
            <AIResultWorkspace
              result={resultWorkspace}
              onClose={closeWorkspace}
            >
              {resultWorkspace.type === "quiz" && quiz && <QuizForm quiz={quiz} onTryAgain={() => setQuiz({ ...quiz })} onNewQuiz={() => send("Generate MCQs", "quiz")} showHeader={false} user={user} />}
              {resultWorkspace.type === "flashcards" && flashcards && <FlashcardsDeck deck={flashcards} showHeader={false} user={user} />}
              {isTextWorkspaceTask(resultWorkspace.type) && (
                <div className="result-text-block">
                  {String(resultWorkspace.content || "").split(/\n{2,}/).filter(Boolean).map((chunk, index) => <p key={`${resultWorkspace.type}-${index}`}>{chunk}</p>)}
                </div>
              )}
            </AIResultWorkspace>
          ) : (
            <div className="result-workspace-placeholder" />
          )}
        </div>
      </div>
      <div className="jump-latest-slot">
        {showJumpToLatest && <button className="btn-ghost jump-latest" onClick={() => scrollToLatest("auto")}>Jump to latest</button>}
      </div>
      <div className="ai-footer">
      <div className="upload-box glass">
        <label className="file-label"><input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(e) => uploadDocument(e.target.files?.[0] || null)} />Choose file</label>
        <span>{processingFile ? "Processing uploaded file..." : fileStatus || "PDF, DOCX, and TXT supported"}</span>
        {processingFile && <div className="upload-spinner" />}
        {(file || document) && <button className="btn-ghost" onClick={() => { setFile(null); setDocument(null); setResultWorkspace(null); setQuiz(null); setFlashcards(null); setFileStatus(""); }}>Clear</button>}
      </div>
      <div className="glass ai-controls">
        <div className="option-group">
          <span>AI Quality</span>
          <div className="segmented">
            {qualityModes.map((mode) => <button key={mode.id} className={qualityMode === mode.id ? "active" : ""} onClick={() => setQualityMode(mode.id)}>{mode.label}</button>)}
          </div>
        </div>
        <span>{qualityModes.find((mode) => mode.id === qualityMode)?.hint || "Balanced quality for normal study"} {isLargeAiDocument(document) ? "Light document handling will still be applied automatically for very large uploads." : ""}</span>
        {cooldownLeft > 0 && <small>Ready for another prompt shortly...</small>}
        {retryRequest && cooldownLeft === 0 && !loading && <button className="btn-ghost subtle-retry" onClick={() => send(retryRequest.message, retryRequest.task)}>Retry</button>}
      </div>
      <div className="glass ai-options-grid">
        <div className="option-group">
          <span>Summary</span>
          <div className="segmented">
            {["short", "detailed"].map((mode) => <button key={mode} className={summaryMode === mode ? "active" : ""} onClick={() => setSummaryMode(mode)}>{mode === "short" ? "Short Summary" : "Detailed Summary"}</button>)}
          </div>
        </div>
        <div className="option-group">
          <span>Quiz Difficulty</span>
          <div className="segmented">
            {["easy", "medium", "hard", "mixed"].map((mode) => <button key={mode} className={quizDifficulty === mode ? "active" : ""} onClick={() => setQuizDifficulty(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
          </div>
        </div>
        <div className="option-group">
          <span>Question Count</span>
          <div className="segmented compact">
            {(qualityMode === "fast" ? [5] : qualityMode === "deep" ? [5, 10, 15] : [5, 10]).map((count) => <button key={count} className={quizCount === count ? "active" : ""} onClick={() => setQuizCount(count)}>{count}</button>)}
          </div>
        </div>
      </div>
      <div className="chip-row">{promptChips.map((chip) => <button className="chip" key={chip.label} onClick={() => send(chip.label, chip.task)} disabled={loading || processingFile}>{chip.label}</button>)}</div>
      <div className="composer"><input className="input" placeholder="Ask Masari Buddy anything..." value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} disabled={processingFile || loading} /><button className="btn-primary" onClick={() => send()} disabled={loading || processingFile || !input.trim()}>Send</button></div>
      </div>
    </section>
  );
}

const AIResultWorkspace = React.memo(function AIResultWorkspace({ result, onClose, children }) {
  return (
    <section className="glass result-workspace">
      <div className="result-workspace-head">
        <div className="result-title-stack">
          <span className="result-badge">{result.badge}</span>
          <h3>{result.title}</h3>
        </div>
        <button className="result-close" onClick={onClose} aria-label={`Close ${result.badge}`}>X</button>
      </div>
      <div className="result-workspace-body">{children}</div>
    </section>
  );
});

const QuizForm = React.memo(function QuizForm({ quiz, onTryAgain, onNewQuiz, showHeader = true, user = null, onSave = null }) {
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const questions = quiz.questions || [];
  const score = questions.reduce((total, question, index) => total + (answers[index] === question.correct ? 1 : 0), 0);
  const answeredCount = Object.keys(answers).length;
  const weakTopics = [...new Set(questions
    .filter((question, index) => submitted && answers[index] !== question.correct)
    .map((question) => cleanTopicLabel(question.topic, "Review this concept")))];
  const submit = () => {
    setSubmitted(true);
    store.set(latestQuizKey, { ...quiz, result: { score, total: questions.length, answers, weakTopics } });
  };
  const reset = () => {
    setAnswers({});
    setSubmitted(false);
    onTryAgain();
  };
  const saveQuiz = async () => {
    if (!user?.id) {
      alert("Please log in to save quizzes");
      return;
    }
    try {
      const response = await fetch("/api/save-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, quiz, fileName: quiz.title || "Quiz" })
      });
      if (!response.ok) throw new Error("Failed to save quiz");
      alert("Quiz saved successfully!");
      if (onSave) onSave();
    } catch (error) {
      console.error("[save-quiz:error]", error);
      alert("Failed to save quiz");
    }
  };

  return (
    <div className="glass quiz-form">
      {showHeader && <div className="quiz-head"><h3>{quiz.title || "File Quiz"}</h3>{submitted && <strong>{score}/{questions.length}</strong>}</div>}
      {!showHeader && submitted && <div className="quiz-inline-score"><strong>{score}/{questions.length}</strong></div>}
      <div className="quiz-progress">{`Question ${Math.min(answeredCount + 1, questions.length)} of ${questions.length} answered`}</div>
      {questions.map((question, index) => (
        <div className={`quiz-question ${submitted ? answers[index] === question.correct ? "correct" : "wrong" : ""}`} key={`${question.question}-${index}`}>
          <div className="quiz-meta">
            <span>{cleanTopicLabel(question.sourceTopic || question.topic, "Source topic")}</span>
            <span>{question.difficulty || "Medium"}</span>
          </div>
          <p><b>{index + 1}.</b> {question.question}</p>
          <div className="quiz-options">
            {["A", "B", "C", "D"].map((letter) => (
              <button key={letter} className={answers[index] === letter ? "selected" : ""} onClick={() => !submitted && setAnswers((next) => ({ ...next, [index]: letter }))}>
                <span>{letter}</span>{question.choices?.[letter]}
              </button>
            ))}
          </div>
          {submitted && <div className="quiz-explain">
            <div><b>Correct:</b> {question.correct}. {question.explanation}</div>
            <div className="wrong-answer-list">
              {["A", "B", "C", "D"].filter((letter) => letter !== question.correct).map((letter) => (
                <p key={letter}><b>{letter}:</b> {question.wrongAnswerNotes?.[letter] || "This option sounds plausible, but it does not match the file closely enough."}</p>
              ))}
            </div>
          </div>}
        </div>
      ))}
      {submitted && weakTopics.length > 0 && <div className="weak-topics"><b>Weak topics:</b> {weakTopics.join(", ")}</div>}
      <div className="focus-actions quiz-sticky-actions">
        {!submitted ? <button className="btn-primary" onClick={submit} disabled={Object.keys(answers).length < questions.length}>Submit Quiz</button> : <button className="btn-ghost" onClick={reset}>Try Again</button>}
        <button className="btn-ghost" onClick={onNewQuiz}>Generate New Quiz</button>
        {submitted && <button className="btn-primary" onClick={saveQuiz}>Save Quiz</button>}
      </div>
    </div>
  );
});

const FlashcardsDeck = React.memo(function FlashcardsDeck({ deck, showHeader = true, user = null, onSave = null }) {
   const [index, setIndex] = useState(0);
   const [flipped, setFlipped] = useState(false);
   const [known, setKnown] = useState(0);
   const [review, setReview] = useState(0);
   const cards = deck.cards || [];
   const card = cards[index] || {};
   const move = (dir) => {
     setFlipped(false);
     setIndex((current) => Math.min(cards.length - 1, Math.max(0, current + dir)));
   };
   const saveFlashcards = async () => {
     if (!user?.id) {
       alert("Please log in to save flashcards");
       return;
     }
     try {
       const response = await fetch("/api/save-flashcards", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ userId: user.id, flashcards: deck, deckName: deck.title || "Flashcards" })
       });
       if (!response.ok) throw new Error("Failed to save flashcards");
       alert("Flashcards saved successfully!");
       if (onSave) onSave();
     } catch (error) {
       console.error("[save-flashcards:error]", error);
       alert("Failed to save flashcards");
     }
   };
   if (!cards.length) return null;
   return (
     <div className="glass flashcards">
       {showHeader && <div className="quiz-head"><h3>{deck.title || "Flashcards"}</h3><strong>{index + 1}/{cards.length}</strong></div>}
       {!showHeader && <div className="quiz-inline-score"><strong>{index + 1}/{cards.length}</strong></div>}
       <button className={`flashcard ${flipped ? "flipped" : ""}`} onClick={() => setFlipped((next) => !next)}>
         <span>{flipped ? "Back" : "Front"}</span>
         <p>{flipped ? card.back : card.front}</p>
         {Array.isArray(card.tags) && card.tags.length > 0 && <div className="flash-tags">{card.tags.slice(0, 3).map((tag) => <i key={tag}>{tag}</i>)}</div>}
       </button>
       <div className="focus-actions">
         <button className="btn-ghost" onClick={() => move(-1)} disabled={index === 0}>Previous</button>
         <button className="btn-ghost" onClick={() => { setReview((next) => next + 1); move(1); }}>Review again</button>
         <button className="btn-primary" onClick={() => { setKnown((next) => next + 1); move(1); }}>I know this</button>
         <button className="btn-ghost" onClick={() => move(1)} disabled={index === cards.length - 1}>Next</button>
         {showHeader && <button className="btn-primary" onClick={saveFlashcards}>Save Deck</button>}
       </div>
       <p className="flash-progress">Known {known} آ· Review again {review}</p>
     </div>
   );
 });

function AIEvolution() {
  const features = [
    ["File Analysis", "Upload materials for AI summaries and key insights.", "Live"],
    ["Auto Quiz Generator", "Generate MCQs and essays from any topic.", "Live"],
    ["Difficulty Rating", "AI rates topic complexity to guide priorities.", "Coming Soon"],
    ["Predictive Scheduling", "Smart study schedules based on deadlines.", "Planned"],
    ["Lecture Summarizer", "Paste transcripts for structured summaries.", "Live"],
    ["Resource Library", "AI-curated resources tailored to courses.", "Planned"]
  ];
  return <section className="fade-in stack"><div className="glass2 evolution-head"><Buddy size={52} /><h2>AI Evolution</h2><p>The future of studying is being built inside Masari.</p></div><div className="evolution-grid">{features.map(([title, text, status]) => <article className="glass evolution-card" key={title}><span>{status}</span><h3>{title}</h3><p>{text}</p><div><i style={{ width: status === "Live" ? "100%" : status === "Coming Soon" ? "45%" : "15%" }} /></div></article>)}</div></section>;
}

function Empty({ title }) {
  return <div className="glass empty"><p>{title}</p></div>;
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error(`[ui:error:${this.props.name || "unknown"}]`, error, info?.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="glass error-boundary">
          <h2>Something needs a quick reset.</h2>
          <p>This feature hit a local UI error. Clear its saved state or reload the app and the rest of Masari will keep working.</p>
          <button className="btn-primary" onClick={() => this.setState({ hasError: false })}>Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function SplashScreen() {
  return (
    <div className="splash-screen">
      <div className="splash-aura" />
      <img src="/masari-logo.svg" alt="Masari" className="splash-logo" />
      <p>Empowering Student Productivity</p>
    </div>
  );
}

function HabidarMascot({ open, onClick }) {
  return (
    <button className={`habidar-button ${open ? "active" : ""}`} onClick={onClick} aria-label="Open Habidar AI assistant">
      <div className="habidar">
        <div className="habidar-crown"><span /><b /><i /></div>
        <div className="habidar-head">
          <div className="habidar-eye left" />
          <div className="habidar-eye right" />
          <div className="habidar-smile" />
        </div>
        <div className="habidar-collar" />
        <div className="habidar-body">
          <span className="habidar-gem" />
        </div>
      </div>
      <span className="habidar-label">Habidar</span>
    </button>
  );
}

function HabidarWidget({ user, tasks, notes, messages, setMessages }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`habidar-widget ${open ? "open" : ""}`}>
      <div className="habidar-panel glass2" aria-hidden={!open}>
        <div className="habidar-panel-head">
          <div><span>Habidar</span><h3>Masari AI Companion</h3></div>
          <button className="btn-ghost" onClick={() => setOpen(false)}>Close</button>
        </div>
        {open && <AIAssistant user={user} compact tasks={tasks} notes={notes} messages={messages} setMessages={setMessages} />}
      </div>
      <HabidarMascot open={open} onClick={() => setOpen((next) => !next)} />
    </div>
  );
}

function App() {
  const [page, setPage] = useState("landing");
  const [user, setUser] = useState(null);
  const [nav, setNav] = useState("dashboard");
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const session = store.get("ms");
    if (session) {
      setUser(session);
      setPage("app");
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setShowSplash(false), splashDuration);
    return () => clearTimeout(timeout);
  }, []);

  const handleAuth = (nextUser) => {
    setUser(nextUser);
    store.set("ms", nextUser);
    setPage("app");
  };
  const handleLogout = () => {
    setUser(null);
    store.del("ms");
    setPage("landing");
  };
  const handleUpdate = (nextUser) => {
    setUser(nextUser);
    store.set("ms", nextUser);
  };

  const [tasks, setTasks] = useUserDocState(user?.id, "tasks", defaultTasks, safeTasks);
  const [notes, setNotes] = useUserDocState(user?.id, "notes", defaultNotes, safeNotes);
  const [focusSettings, setFocusSettings] = useUserDocState(user?.id, "pomodoro", { focus: 25, break: 5, sessions: 4 }, safeFocusSettings);
  const [focusStats, setFocusStats] = useUserDocState(user?.id, "focusStats", defaultFocusStats, safeFocusStats);
  const [gardenState, setGardenState] = useUserDocState(user?.id, "focusGarden", { minutes: 0, sessionsCompleted: 0 }, safeGarden);
  const [flightState, setFlightState] = useUserDocState(user?.id, "focusFlight", defaultFlight, safeFlight);
  const [candleState, setCandleState] = useUserDocState(user?.id, "candle", { preset: 60, glow: 72, ambience: "Library hush", soundOn: false, previewSeconds: 60 * 60 }, safeCandleFocus);
  const [aiMessages, setAiMessages] = useUserDocState(user?.id, "aiChat", defaultAiMessages, (value) => safeAiMessages(value, user?.name || "there"));

  if (showSplash) return <SplashScreen />;
  if (page === "landing") return <Landing onStart={() => setPage("signup")} onLogin={() => setPage("login")} />;
  if (page === "signup") return <Auth mode="signup" onSuccess={handleAuth} onToggle={() => setPage("login")} />;
  if (page === "login") return <Auth mode="login" onSuccess={handleAuth} onToggle={() => setPage("signup")} />;

  const views = {
    dashboard: <Dashboard user={user} onNav={setNav} tasks={tasks} notes={notes} focusStats={focusStats} />,
    tasks: <Tasks tasks={tasks} setTasks={setTasks} />,
    notes: <Notes notes={notes} setNotes={setNotes} />,
    pomodoro: <Pomodoro settings={focusSettings} setSettings={setFocusSettings} focusStats={focusStats} setFocusStats={setFocusStats} setGardenState={setGardenState} />,
    garden: <FocusGardenPage stats={focusStats} garden={gardenState} />,
    flight: <FocusFlightPage stats={focusStats} flight={flightState} setFlight={setFlightState} />,
    candle: <CandleFocusPage prefs={candleState} setPrefs={setCandleState} />,
    ai: <AIAssistant user={user} tasks={tasks} notes={notes} messages={aiMessages} setMessages={setAiMessages} />,
    evolution: <AIEvolution />,
    profile: <Profile user={user} onUpdate={handleUpdate} />
  };

  return (
    <div className="app-shell">
      <Sidebar active={nav} onNav={setNav} user={user} onLogout={handleLogout} />
      <main className="app-main"><div className="content"><ErrorBoundary key={nav} name={nav}>{views[nav] || views.dashboard}</ErrorBoundary></div></main>
      <HabidarWidget user={user} tasks={tasks} notes={notes} messages={aiMessages} setMessages={setAiMessages} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);


