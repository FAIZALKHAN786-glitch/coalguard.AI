import { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard,
  Map,
  ShieldCheck,
  ClipboardCheck,
  TriangleAlert,
  HardHat,
  MapPin,
  Sparkles,
  FolderOpen,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Search,
  Bell,
  Settings2,
  ArrowUpRight,
  HelpCircle,
  PanelLeftClose,
  Menu,
  X,
  LogOut,
  ArrowRight,
  Check,
  Loader2,
  FileBarChart,
  Factory,
  Leaf,
  Users,
  MessageSquare,
  Fingerprint,
  Command,
  WifiOff,
  Plus,
  Building2,
} from "lucide-react";
import {
  api,
  ApiError,
  localStore,
  sessionStore,
  hasPreviewSession,
  clearPreviewSession,
  signIn,
  sessionExpired,
  post,
  useData,
  useRoute,
  navigate,
  kindMeta,
  refresh,
  dateLabel,
  label,
} from "./lib";
import type { User, Mine, Kind, Entry, Notice } from "./types";
import { Logo, Modal, Loading, ErrorBox, Empty, Badge } from "./components/UI";
import { Dashboard } from "./components/Dashboard";
import { Records, RecordDetail } from "./components/Records";
import { RecordEditor } from "./components/RecordEditor";
import { Mines } from "./components/Mines";
import { Intelligence } from "./components/Intelligence";
import { Documents } from "./components/Documents";
import { Reports, Audit } from "./components/Reports";
import { Settings, MineForm } from "./components/Settings";
const navigation = [
  { id: "dashboard", name: "Overview", icon: LayoutDashboard },
  { id: "mines", name: "Mine portfolio", icon: Map },
  { id: "compliance", name: "Compliance", icon: ShieldCheck },
  { id: "inspection", name: "Inspections", icon: ClipboardCheck },
  { id: "action", name: "Corrective actions", icon: TriangleAlert },
  { id: "contractor", name: "Contractors", icon: HardHat },
  { id: "field", name: "Field workspace", icon: MapPin },
  { id: "intelligence", name: "Intelligence", icon: Sparkles },
  { id: "documents", name: "Documents & OCR", icon: FolderOpen },
];
const recordNav = [
  { id: "reports", name: "Report builder", icon: FileBarChart },
  { id: "operation", name: "Production", icon: Factory },
  { id: "environment", name: "Environment", icon: Leaf },
  { id: "attendance", name: "Attendance", icon: Users },
  { id: "grievance", name: "Grievances", icon: MessageSquare },
  { id: "audit", name: "Audit trail", icon: Fingerprint },
];
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [config, setConfig] = useState<{ demo: boolean } | null>(null),
    [booting, setBooting] = useState(true),
    [bootError, setBootError] = useState("");
  useEffect(() => {
    async function boot() {
      try {
        const c = await api("/config");
        setConfig(c);
        let u;
        try {
          u = (await api("/auth/me")).user;
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401) throw error;
          if (c.demo && !sessionStore.getItem("cg-signed-out"))
            u = await signIn("/auth/demo", {});
        }
        if (u) {
          setUser(u);
          localStore.setItem("cg-offline-profile", JSON.stringify(u));
        }
      } catch (e) {
        if (!navigator.onLine) {
          try {
            const cached = JSON.parse(
              localStore.getItem("cg-offline-profile") || "null",
            );
            if (cached) setUser(cached);
            else
              setBootError(
                "Reconnect once to initialize your field workspace.",
              );
          } catch {
            setBootError("Unable to open offline workspace.");
          }
        } else setBootError((e as Error).message);
      } finally {
        setBooting(false);
      }
    }
    void boot();
  }, []);
  useEffect(() => {
    const expired = () => {
      localStore.removeItem("cg-offline-profile");
      sessionStore.setItem("cg-signed-out", "true");
      setUser(null);
      setBootError(
        "Your session expired or is unavailable. Sign in below to continue.",
      );
    };
    window.addEventListener("cg-session-expired", expired);
    return () => window.removeEventListener("cg-session-expired", expired);
  }, []);
  const login = (u: User) => {
    setBootError("");
    sessionStore.removeItem("cg-signed-out");
    localStore.setItem("cg-offline-profile", JSON.stringify(u));
    setUser(u);
  };
  async function logout() {
    try {
      try {
        await post("/auth/logout", {});
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
      clearPreviewSession();
      localStore.removeItem("cg-offline-profile");
      localStore.removeItem(`cg-mines-${user?.id}`);
      sessionStore.setItem("cg-signed-out", "true");
      setUser(null);
    } catch (e) {
      alert(
        `Sign-out failed: ${(e as Error).message}. Reconnect to revoke your session.`,
      );
    }
  }
  if (booting)
    return (
      <div className="boot-screen">
        <Logo />
        <Loading />
      </div>
    );
  if (!user)
    return (
      <Login demo={config?.demo || false} onLogin={login} error={bootError} />
    );
  return (
    <Workspace user={user} demo={config?.demo || false} onLogout={logout} />
  );
}
function Login({
  demo,
  onLogin,
  error: bootError,
}: {
  demo: boolean;
  onLogin: (u: User) => void;
  error: string;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(bootError),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(await signIn("/auth/login", { email, password }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-story">
        <Logo />
        <div>
          <span className="eyebrow">
            CONNECTED GOVERNANCE. GROUNDED IN TRUST.
          </span>
          <h1>
            A clearer view.
            <br />A safer tomorrow.
          </h1>
          <p>
            One connected ecosystem for your mines, your people, and every
            responsibility in between.
          </p>
          <div className="login-trust">
            <ShieldCheck size={19} /> Designed for the Indian coal mining
            ecosystem
          </div>
        </div>
        <small>Better governance starts from the ground up.</small>
      </div>
      <div className="login-form-side">
        <form className="login-form" onSubmit={submit}>
          <span className="large-icon">
            <ShieldCheck size={29} />
          </span>
          <h2>Welcome to CoalGuard.</h2>
          <p>Sign in to your governance workspace.</p>
          {error && <ErrorBox message={error} />}
          <label>
            Work email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@organization.in"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Your password"
            />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <Loader2 className="spin" size={17} />
            ) : (
              <>
                Sign in <ArrowRight size={17} />
              </>
            )}
          </button>
          {demo && (
            <div className="demo-login">
              <strong>Explore the demonstration workspace</strong>
              <p>Fictional operational records. Real, working workflows.</p>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    onLogin(await signIn("/auth/demo", {}));
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? (
                  <>
                    <Loader2 size={16} className="spin" /> Opening workspace…
                  </>
                ) : (
                  <>
                    Enter demo workspace <ArrowUpRight size={16} />
                  </>
                )}
              </button>
              <details>
                <summary>Try a different role</summary>
                <p>
                  Use <code>admin@coalguard.demo</code>,{" "}
                  <code>officer@coalguard.demo</code>,{" "}
                  <code>field@coalguard.demo</code>, or{" "}
                  <code>regulator@coalguard.demo</code>.<br />
                  Demo password: <code>CoalGuard@2026</code>
                </p>
              </details>
            </div>
          )}
          <a
            className="login-new-tab"
            href={window.location.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open workspace in a new tab <ArrowUpRight size={15} />
          </a>
          <small className="login-help">
            Need access? Contact your workspace administrator.
          </small>
        </form>
      </div>
    </div>
  );
}
function Workspace({
  user,
  demo,
  onLogout,
}: {
  user: User;
  demo: boolean;
  onLogout: () => void;
}) {
  useEffect(() => {
    // Native EventSource cannot attach the preview session header. Preview fallback uses
    // the existing authenticated polling; never place session tokens in URLs.
    if (hasPreviewSession()) return;
    const events = new EventSource("/api/events");
    events.addEventListener("change", refresh);
    events.addEventListener("expired", () => {
      events.close();
      sessionExpired();
    });
    return () => events.close();
  }, [user.id]);
  const route = useRoute();
  const { data: mineData } = useData<Mine[]>("/mines");
  const [mine, setMine] = useState("all"),
    [menu, setMenu] = useState(false),
    [recordsOpen, setRecordsOpen] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [notificationsOpen, setNotificationsOpen] = useState(false),
    [help, setHelp] = useState(false),
    [newMine, setNewMine] = useState(false),
    [editor, setEditor] = useState<{ kind: Kind; entry?: Entry } | null>(null),
    [detail, setDetail] = useState<Entry | null>(null),
    [toastMessage, setToast] = useState(""),
    [online, setOnline] = useState(navigator.onLine);
  const { data: notices } = useData<Notice[]>(`/notifications?mine=${mine}`);
  const [cachedMines] = useState<Mine[]>(() => {
    try {
      return JSON.parse(localStore.getItem(`cg-mines-${user.id}`) || "[]");
    } catch {
      return [];
    }
  });
  const mines = mineData || cachedMines;
  useEffect(() => {
    if (mineData)
      localStore.setItem(`cg-mines-${user.id}`, JSON.stringify(mineData));
  }, [mineData, user.id]);
  useEffect(() => {
    setMenu(false);
    window.scrollTo(0, 0);
    if (recordNav.some((n) => n.id === route)) setRecordsOpen(true);
  }, [route]);
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(t);
  }, [toastMessage]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((s) => !s);
      }
    };
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("keydown", f);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("keydown", f);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  const toast = useCallback((s: string) => setToast(s), []);
  useEffect(() => {
    const notice = (event: Event) =>
      setToast((event as CustomEvent<string>).detail);
    window.addEventListener("cg-notice", notice);
    return () => window.removeEventListener("cg-notice", notice);
  }, []);
  const create = (k: Kind) => setEditor({ kind: k });
  const openMine = (id: string) => {
    setMine(id);
    navigate("compliance");
  };
  const pageTitle =
    navigation.find((n) => n.id === route)?.name ||
    recordNav.find((n) => n.id === route)?.name ||
    (route === "settings" ? "Settings" : "Workspace");
  async function remove() {
    if (
      !detail ||
      !confirm(
        "Delete this record? The deletion will remain in the audit trail.",
      )
    )
      return;
    try {
      await api(`/records/${detail.kind}/${detail.id}`, { method: "DELETE" });
      setDetail(null);
      refresh();
      toast("Record deleted. Audit history retained.");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  let content;
  if (route === "dashboard")
    content = (
      <Dashboard
        mine={mine}
        user={user}
        onCreate={create}
        onEdit={setDetail}
        onMine={openMine}
      />
    );
  else if (route in kindMeta)
    content = (
      <Records
        key={route}
        kind={route as Kind}
        mine={mine}
        mines={mines}
        user={user}
        onCreate={create}
        onOpen={setDetail}
        toast={toast}
      />
    );
  else if (route === "mines")
    content = (
      <Mines
        mine={mine}
        user={user}
        onMine={openMine}
        onAdd={() => setNewMine(true)}
      />
    );
  else if (route === "intelligence")
    content = <Intelligence key={mine} mine={mine} />;
  else if (route === "documents")
    content = (
      <Documents
        key={mine}
        mine={mine}
        mines={mines}
        user={user}
        toast={toast}
      />
    );
  else if (route === "reports") content = <Reports mine={mine} />;
  else if (route === "audit") content = <Audit mine={mine} user={user} />;
  else if (route === "settings")
    content = (
      <Settings
        user={user}
        mines={mines}
        onAddMine={() => setNewMine(true)}
        toast={toast}
        onLogout={onLogout}
      />
    );
  else
    content = (
      <Empty
        title="Page not found"
        text="Choose a section from the workspace navigation."
      />
    );
  return (
    <div className="app-shell">
      {menu && <div className="sidebar-scrim" onClick={() => setMenu(false)} />}
      <aside className={`sidebar ${menu ? "mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <Logo />
          <button
            className="icon-button mobile-close"
            aria-label="Close navigation"
            onClick={() => setMenu(false)}
          >
            <X size={20} />
          </button>
        </div>
        <button
          className="workspace-switch"
          onClick={() => navigate("settings")}
        >
          <span className="org-avatar">
            <Building2 size={19} />
          </span>
          <span>
            <strong>Coal India workspace</strong>
            <small>
              {demo ? "Demonstration portfolio" : "Governance workspace"}
            </small>
          </span>
          <ChevronsUpDown size={14} />
        </button>
        <div className="sidebar-scroll">
          <div className="nav-label">WORKSPACE</div>
          <nav aria-label="Main navigation">
            {navigation.map((n, i) => (
              <button
                key={n.id}
                className={`nav-item ${route === n.id ? "active" : ""} ${n.id === "intelligence" ? "intelligence-nav" : ""}`}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={18} strokeWidth={1.7} />
                <span>{n.name}</span>
                {n.id === "intelligence" ? (
                  <span className="ai-chip">AI</span>
                ) : n.id === "field" ? (
                  <span className="nav-live-dot" />
                ) : null}
                {route === n.id && <span className="nav-active-dot" />}
              </button>
            ))}
            <button
              className={`nav-item ${recordNav.some((n) => n.id === route) ? "active-parent" : ""}`}
              onClick={() => setRecordsOpen(!recordsOpen)}
              aria-expanded={recordsOpen}
            >
              <ChartNoAxesCombined size={18} strokeWidth={1.7} />
              <span>Reports & records</span>
              <ChevronDown size={14} className={recordsOpen ? "rotated" : ""} />
            </button>
            {recordsOpen && (
              <div className="subnav">
                {recordNav.map((n) => (
                  <button
                    key={n.id}
                    className={route === n.id ? "active" : ""}
                    onClick={() => navigate(n.id)}
                  >
                    <n.icon size={15} />
                    {n.name}
                  </button>
                ))}
              </div>
            )}
          </nav>
        </div>
        <div className="sidebar-bottom">
          <div className="trust-card">
            <span className="trust-icon">
              <ShieldCheck size={21} />
            </span>
            <strong>Built on trust.</strong>
            <p>
              Every action accounted for.
              <br />
              Every mine, connected.
            </p>
            <button onClick={() => navigate("audit")}>
              Explore audit trail <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className={`nav-item ${route === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} />
            <span>Settings</span>
          </button>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <HelpCircle size={18} />
            <span>Help & getting started</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-user">
            <button onClick={() => navigate("settings")}>
              <span className="avatar">
                {user.name
                  .split(" ")
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span>
                <strong>{user.name}</strong>
                <small>{label(user.role)} workspace</small>
              </span>
            </button>
            <button
              className="icon-button"
              onClick={onLogout}
              aria-label="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span className="desktop-crumb">Workspace</span>
            <ChevronRight size={13} className="desktop-crumb" />
            <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="global-search-trigger"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={16} />
              <span>Search anything…</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="topbar-date">
              {new Date().toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </span>
            <button
              className={`icon-button notification-trigger ${notices?.some((n) => !n.read) ? "has-notifications" : ""}`}
              aria-label="Open notifications"
              onClick={() => setNotificationsOpen(true)}
            >
              <Bell size={19} />
            </button>
            <button
              className="avatar topbar-avatar"
              onClick={() => navigate("settings")}
              aria-label="Open profile"
            >
              {user.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")}
            </button>
          </div>
        </header>
        <div className="scopebar">
          <div className="scope-select">
            <Building2 size={15} />
            <select
              aria-label="Select mine scope"
              value={mine}
              onChange={(e) => setMine(e.target.value)}
            >
              <option value="all">All mine sites</option>
              {mines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.subsidiary}
                </option>
              ))}
            </select>
          </div>
          <span className="scope-divider" />
          <span className="scope-region">
            {mine === "all"
              ? "Portfolio view"
              : mines.find((m) => m.id === mine)?.region}
          </span>
          <div className="scopebar-right">
            {demo && (
              <span className="demo-label">
                DEMO WORKSPACE <span>·</span> Illustrative data
              </span>
            )}
            <span className={`connection-status ${!online ? "offline" : ""}`}>
              {online ? <span className="tiny-dot" /> : <WifiOff size={13} />}{" "}
              {online ? "Connected" : "Offline"}
            </span>
          </div>
        </div>
        <main className="main-content">{content}</main>
      </div>
      {toastMessage && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toastMessage}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {editor && (
        <RecordEditor
          kind={editor.kind}
          entry={editor.entry}
          mines={mines}
          mine={mine}
          user={user}
          onClose={() => setEditor(null)}
          onSaved={toast}
        />
      )}
      {detail && (
        <RecordDetail
          entry={detail}
          mines={mines}
          user={user}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditor({ kind: detail.kind, entry: detail });
            setDetail(null);
          }}
          onDelete={remove}
        />
      )}
      {newMine && <MineForm onClose={() => setNewMine(false)} toast={toast} />}
      {searchOpen && (
        <GlobalSearch
          mine={mine}
          onClose={() => setSearchOpen(false)}
          onOpen={(r) => {
            setDetail(r);
            setSearchOpen(false);
          }}
        />
      )}
      {notificationsOpen && (
        <Modal
          title="Your attention, where it matters."
          subtitle="Due-date reminders and overdue escalations · evaluated from live records"
          onClose={() => setNotificationsOpen(false)}
        >
          <div className="notifications-content">
            <div className="notification-actions">
              <span>{notices?.filter((n) => !n.read).length || 0} unread</span>
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await post("/notifications/read", {
                      ids: notices?.map((n) => n.id) || [],
                    });
                    refresh();
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                Mark all as read <Check size={14} />
              </button>
            </div>
            {notices?.map((n) => (
              <button
                key={n.id}
                className={`notification-item ${n.read ? "read" : ""}`}
                onClick={async () => {
                  try {
                    const rows = await api<Entry[]>(
                      `/records/${n.kind}?mine=${n.mineId}`,
                    );
                    const r = rows.find((r) => r.id === n.recordId);
                    if (r) setDetail(r);
                    await post("/notifications/read", { ids: [n.id] });
                    setNotificationsOpen(false);
                    refresh();
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                <span className={`radar-dot ${n.severity}`}>
                  <TriangleAlert size={16} />
                </span>
                <div>
                  <strong>{n.title}</strong>
                  <p>{mines.find((m) => m.id === n.mineId)?.name}</p>
                  <small>{n.message}</small>
                </div>
                {!n.read && <span className="tiny-dot" />}
              </button>
            ))}
            {!notices?.length && (
              <Empty
                title="You're all caught up"
                text="No reminders within the next seven days."
              />
            )}
          </div>
        </Modal>
      )}
      {help && (
        <Modal
          title="Welcome to connected governance."
          subtitle="A short guide to making the most of your workspace."
          onClose={() => setHelp(false)}
        >
          <div className="help-content">
            {[
              [
                "01",
                "Start with your mine portfolio",
                "Choose a mine in the top bar, or use the portfolio view for cross-site oversight. Administrators can add mines and team members in Settings.",
              ],
              [
                "02",
                "Turn responsibilities into records",
                "Create obligations, plan inspections, record findings, and assign corrective actions. Officers submit reviews; administrators approve compliance with evidence.",
              ],
              [
                "03",
                "Keep the field connected",
                "Field reports capture time and optional device GPS. Offline reports remain in this browser’s local queue until you press Sync reports. Use trusted devices.",
              ],
              [
                "04",
                "Build a defensible evidence trail",
                "Upload documents, copy their evidence IDs into compliance records, and export reports. OCR output and AI recommendations always need human review.",
              ],
              [
                "05",
                "Connect your intelligence",
                "Add provider credentials to the server environment using .env.example. Without models, transparent screening and keyword document retrieval remain available.",
              ],
            ].map(([n, t, d]) => (
              <div key={n}>
                <span>{n}</span>
                <div>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              </div>
            ))}
            <div className="subtle-note">
              <p>
                {demo
                  ? "This demo contains fictional records for real mine locations. It is not affiliated with or endorsed by Coal India or a regulator."
                  : "Validate the regulatory register and your deployment security before live operational use."}
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function GlobalSearch({
  mine,
  onClose,
  onOpen,
}: {
  mine: string;
  onClose: () => void;
  onOpen: (r: Entry) => void;
}) {
  const [q, setQ] = useState(""),
    [rows, setRows] = useState<Entry[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all(
      Object.keys(kindMeta).map((k) =>
        api<Entry[]>(`/records/${k}?mine=${mine}`),
      ),
    )
      .then((all) => {
        if (active) setRows(all.flat());
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mine]);
  const matches = q.trim()
    ? rows
        .filter((r) =>
          `${r.title} ${r.owner} ${r.category} ${r.notes}`
            .toLowerCase()
            .includes(q.toLowerCase()),
        )
        .slice(0, 15)
    : [];
  return (
    <Modal
      title="Find your next step."
      subtitle="Search records within your selected mine scope."
      onClose={onClose}
    >
      <div className="search-modal">
        <div className="input-search">
          <Search size={19} />
          <input
            autoFocus
            placeholder="Search obligations, contractors, observations…"
            aria-label="Search all records"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} />
        ) : !q ? (
          <div className="quick-pages">
            <span className="eyebrow">QUICK NAVIGATION</span>
            {[...navigation, ...recordNav].map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  navigate(n.id);
                  onClose();
                }}
              >
                <n.icon size={17} />
                {n.name}
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
        ) : matches.length ? (
          matches.map((r) => (
            <button
              className="search-result"
              key={r.id}
              onClick={() => onOpen(r)}
            >
              <div>
                <strong>{r.title}</strong>
                <small>
                  {kindMeta[r.kind].title} · {r.owner}
                </small>
              </div>
              <Badge value={r.status} />
            </button>
          ))
        ) : (
          <Empty
            title="No matching records"
            text="Try a title, category, responsible person, or a word from the notes."
          />
        )}
      </div>
    </Modal>
  );
}
