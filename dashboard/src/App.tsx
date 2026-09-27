import { lazy, Suspense, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api } from "./lib/api";
import Board from "./pages/Board";
import JobDetail from "./pages/JobDetail";
import Jobs from "./pages/Jobs";
import Login from "./pages/Login";
import Runs from "./pages/Runs";

// recharts only loads on the Consumption page
const Consumption = lazy(() => import("./pages/Consumption"));

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "auto");
  const next = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
  return (
    <button
      className="btn small"
      title="Theme: auto follows your OS"
      onClick={() => {
        if (next === "auto") delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = next;
        try {
          if (next === "auto") localStorage.removeItem("theme");
          else localStorage.setItem("theme", next);
        } catch {
          /* ignore */
        }
        setTheme(next);
      }}
    >
      Theme: {theme}
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

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" width={22} height={22} alt="" /> Job Tracker
        </div>
        <nav className="nav">
          <NavLink to="/jobs">Jobs</NavLink>
          <NavLink to="/board">Board</NavLink>
          <NavLink to="/consumption">Consumption</NavLink>
          <NavLink to="/runs">Runs</NavLink>
        </nav>
        <div className="spacer" />
        <ThemeToggle />
        <span className="muted hide-sm">{email}</span>
        {!api.demo && (
          <button className="btn small" onClick={() => api.signOut().then(() => setEmail(null))}>
            Sign out
          </button>
        )}
      </header>
      <main>
        {api.demo && (
          <div className="banner">
            Demo mode: showing sample data. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to
            use your real jobs.
          </div>
        )}
        <Routes>
          <Route path="/" element={<Navigate to="/jobs" replace />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/board" element={<Board />} />
          <Route
            path="/consumption"
            element={
              <Suspense fallback={<div className="muted">Loading…</div>}>
                <Consumption />
              </Suspense>
            }
          />
          <Route path="/runs" element={<Runs />} />
          <Route path="*" element={<Navigate to="/jobs" replace />} />
        </Routes>
      </main>
    </div>
  );
}
