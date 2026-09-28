import { Columns3, Gauge, GraduationCap, History, LogOut, Monitor, Moon, Plus, Sun, Table2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { ICON, Notice } from "./components/bits";
import { api } from "./lib/api";
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
  { to: "/consumption", label: "Consumption", short: "Usage", Icon: Gauge },
  { to: "/runs", label: "Runs", short: "Runs", Icon: History },
];

/** A drawing sheet: frame, title block, and a check mark in ballpoint ink. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="27" height="27" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5.5" y="5.5" width="21" height="21" stroke="currentColor" strokeWidth="1" />
      <path d="M15 20.5h11.5M15 20.5v6M20.5 20.5v6" stroke="currentColor" strokeWidth="1" />
      <path d="M8.5 11.5l2.5 2.5 5-5.5" stroke="var(--accent)" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

type Theme = "auto" | "light" | "dark";

function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) ?? "auto");
  const next: Theme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
  const Icon = theme === "auto" ? Monitor : theme === "light" ? Sun : Moon;
  const label = theme === "auto" ? "Theme: follows your device" : theme === "light" ? "Theme: drawing sheet (light)" : "Theme: blueprint (dark)";
  return (
    <button
      className={`btn quiet small${compact ? "" : " block"}`}
      style={compact ? undefined : { justifyContent: "flex-start" }}
      title={`${label}. Switch to ${next}.`}
      aria-label={`${label}. Switch to ${next}.`}
      onClick={() => {
        if (next === "auto") delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = next;
        try {
          if (next === "auto") localStorage.removeItem("theme");
          else localStorage.setItem("theme", next);
        } catch {
          /* storage unavailable: the choice lasts for this visit */
        }
        setTheme(next);
      }}
    >
      <Icon {...ICON} />
      {!compact && (theme === "auto" ? "Device theme" : theme === "light" ? "Sheet (light)" : "Blueprint (dark)")}
    </button>
  );
}

export default function App() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    api.currentEmail().then(setEmail);
  }, []);

  if (email === undefined) return null;
  if (email === null) return <Login onSignedIn={() => api.currentEmail().then(setEmail)} />;

  const signOut = () => api.signOut().then(() => setEmail(null));

  return (
    <div className="shell">
      <aside className="rail">
        <Link to="/jobs" className="brand">
          <Mark /> Fairsheet
        </Link>
        <nav className="nav" aria-label="Sheets">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to}>
              <Icon {...ICON} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="rail-foot">
          <Link to="/add" className="btn block">
            <Plus {...ICON} />
            Add a job
          </Link>
          <ThemeToggle />
          <div className="who">{email}</div>
          {!api.demo && (
            <button className="btn quiet small block" style={{ justifyContent: "flex-start" }} onClick={signOut}>
              <LogOut {...ICON} />
              Sign out
            </button>
          )}
        </div>
      </aside>

      <header className="mobile-head">
        <Link to="/jobs" className="brand" style={{ padding: 0 }}>
          <Mark /> Fairsheet
        </Link>
        <div className="spacer" />
        <Link to="/add" className="btn small" aria-label="Add a job">
          <Plus {...ICON} />
          Add
        </Link>
        <ThemeToggle compact />
        {!api.demo && (
          <button className="btn quiet small" onClick={signOut} aria-label="Sign out">
            <LogOut {...ICON} />
          </button>
        )}
      </header>

      <main className="sheet">
        <div className="sheet-inner">
          {api.demo && (
            <Notice>
              Demo mode: sample data, nothing is saved. Set <code>VITE_SUPABASE_URL</code> and{" "}
              <code>VITE_SUPABASE_ANON_KEY</code> to open your own tracker.
            </Notice>
          )}
          <div className="frame">
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
        </div>
      </main>

      <nav className="bottom-nav" aria-label="Sheets">
        {NAV.map(({ to, short, Icon }) => (
          <NavLink key={to} to={to}>
            <Icon {...ICON} size={20} />
            {short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
