import { Columns3, Gauge, GraduationCap, History, LogOut, Monitor, Moon, Plus, Search, Sun, Table2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { ICON, Mark, Notice } from "./components/bits";
import CommandMenu, { openCommandMenu } from "./components/CommandMenu";
import { api } from "./lib/api";
import { istTime, nextScan } from "./lib/format";
import { applyTheme, currentTheme, THEME_LABEL, type Theme } from "./lib/theme";
import AddJob from "./pages/AddJob";
import Board from "./pages/Board";
import JobDetail from "./pages/JobDetail";
import Jobs from "./pages/Jobs";
import Login from "./pages/Login";
import Runs from "./pages/Runs";
import Skills from "./pages/Skills";

// recharts only loads on the Consumption page
const Consumption = lazy(() => import("./pages/Consumption"));

const NAV = [
  { to: "/jobs", label: "Jobs", short: "Jobs", Icon: Table2 },
  { to: "/board", label: "Board", short: "Board", Icon: Columns3 },
  { to: "/skills", label: "Skills", short: "Skills", Icon: GraduationCap },
  { to: "/consumption", label: "Consumption", short: "Consumption", Icon: Gauge },
  { to: "/runs", label: "Runs", short: "Runs", Icon: History },
];

const NEXT_THEME: Record<Theme, Theme> = { dark: "light", light: "system", system: "dark" };
const THEME_ICON: Record<Theme, typeof Moon> = { dark: Moon, light: Sun, system: Monitor };

function ThemeButton({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    window.addEventListener("fairsheet:theme", sync);
    return () => window.removeEventListener("fairsheet:theme", sync);
  }, []);
  const Icon = THEME_ICON[theme];
  const label = `Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[NEXT_THEME[theme]]}.`;
  return (
    <button className={`btn quiet small${compact ? "" : " block"}`} title={label} aria-label={label} onClick={() => applyTheme(NEXT_THEME[theme])}>
      <Icon {...ICON} size={14} />
      {!compact && THEME_LABEL[theme]}
    </button>
  );
}

function SearchButton() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button className="search-btn" onClick={openCommandMenu} aria-label="Search or jump to (Command K)">
      <Search {...ICON} size={14} />
      <span className="grow">Search…</span>
      <kbd>{mac ? "⌘" : "Ctrl"}</kbd>
      <kbd>K</kbd>
    </button>
  );
}

function useCounts(signedIn: boolean) {
  const [counts, setCounts] = useState<{ ready: number; triage: number } | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    const load = () => api.counts().then(setCounts, () => setCounts(null));
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [signedIn]);
  return counts;
}

export default function App() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const counts = useCounts(!!email);

  useEffect(() => {
    // a failed session check means "signed out", never a blank page
    api.currentEmail().then(setEmail, () => setEmail(null));
  }, []);

  if (email === undefined) return <p className="boot">Opening Fairsheet…</p>;
  if (email === null) return <Login onSignedIn={() => api.currentEmail().then(setEmail)} />;

  const signOut = api.demo ? undefined : () => api.signOut().then(() => setEmail(null));

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/jobs" className="brand">
          <Mark />
          <span className="brand-name">
            Fairsheet
            <span className="xs">
              <span className="pulse" aria-hidden />
              Next scan {istTime(nextScan())} IST
            </span>
          </span>
        </Link>
        <SearchButton />
        <Link to="/add" className="btn block">
          <Plus {...ICON} size={14} />
          Add a job
        </Link>
        <nav className="nav" aria-label="Pages">
          <div className="nav-label">Workspace</div>
          {NAV.map(({ to, label, Icon }) => {
            const count = counts && (to === "/jobs" ? counts.triage : to === "/board" ? counts.ready : null);
            const hint = to === "/jobs" ? "in the New tab" : "in the Ready tab, resumes ready to apply with";
            return (
              <NavLink key={to} to={to}>
                <Icon {...ICON} />
                {label}
                {!!count && (
                  <span className="count" title={`${count} ${hint}`} aria-label={`${count} ${hint}`}>
                    {count}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <ThemeButton />
          <div className="account">
            <span className="avatar" aria-hidden>
              {email.slice(0, 1).toUpperCase()}
            </span>
            <span className="who" title={email}>
              {email}
            </span>
            {signOut && (
              <button className="btn quiet small" onClick={signOut} aria-label="Sign out" title="Sign out">
                <LogOut {...ICON} size={14} />
              </button>
            )}
          </div>
        </div>
      </aside>

      <header className="mobile-head">
        <Link to="/jobs" className="brand" style={{ padding: 0 }}>
          <Mark size={22} /> Fairsheet
        </Link>
        <div className="spacer" />
        <button className="btn quiet" onClick={openCommandMenu} aria-label="Search or jump to">
          <Search {...ICON} />
        </button>
        <Link to="/add" className="btn" aria-label="Add a job">
          <Plus {...ICON} />
        </Link>
        <ThemeButton compact />
      </header>

      <main className="main">
        <div className="main-inner">
          {api.demo && (
            <Notice>
              Demo mode: sample data, nothing is saved. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to open
              your own tracker.
            </Notice>
          )}
          <Routes>
            <Route path="/" element={<Navigate to="/jobs" replace />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/board" element={<Board />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/add" element={<AddJob />} />
            <Route
              path="/consumption"
              element={
                <Suspense fallback={<p className="muted">Loading consumption…</p>}>
                  <Consumption />
                </Suspense>
              }
            />
            <Route path="/runs" element={<Runs />} />
            <Route path="*" element={<Navigate to="/jobs" replace />} />
          </Routes>
        </div>
      </main>

      <nav className="tabbar" aria-label="Pages">
        {NAV.map(({ to, short, Icon }) => (
          <NavLink key={to} to={to}>
            <Icon {...ICON} size={20} />
            {short}
          </NavLink>
        ))}
      </nav>

      <CommandMenu onSignOut={signOut} />
    </div>
  );
}
