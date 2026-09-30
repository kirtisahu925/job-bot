import {
  Activity as ActivityIcon,
  Building2,
  Columns3,
  Gauge,
  GraduationCap,
  History,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Search,
  Send,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sun,
  Table2,
  UsersRound,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { ICON, Mark, Notice } from "./components/bits";
import CommandMenu, { openCommandMenu } from "./components/CommandMenu";
import { api } from "./lib/api";
import { contactsApi } from "./lib/contacts/api";
import { istTime, nextScan } from "./lib/format";
import { applyTheme, currentTheme, THEME_LABEL, type Theme } from "./lib/theme";
import AddJob from "./pages/AddJob";
import Board from "./pages/Board";
import JobDetail from "./pages/JobDetail";
import Jobs from "./pages/Jobs";
import Login from "./pages/Login";
import Runs from "./pages/Runs";
import Skills from "./pages/Skills";

// recharts only loads on the Consumption page; the Contacts add-on only for accounts that have it
const Consumption = lazy(() => import("./pages/Consumption"));
const Contacts = lazy(() => import("./pages/Contacts"));
const ContactDetail = lazy(() => import("./pages/ContactDetail"));
const ContactsImport = lazy(() => import("./pages/ContactsImport"));
const ContactsSettings = lazy(() => import("./pages/ContactsSettings"));
const Applications = lazy(() => import("./pages/Applications"));
const Companies = lazy(() => import("./pages/Companies"));
const Activity = lazy(() => import("./pages/Activity"));
const Preferences = lazy(() => import("./pages/Preferences"));
const Settings = lazy(() => import("./pages/Settings"));
const loading = <p className="muted">Loading…</p>;

type NavItem = { to: string; label: string; short: string; Icon: typeof Table2; feature?: string; group: "work" | "insight" | "you"; tab?: number };

// `tab`: the order on the phone tab bar, which shows the first five the account has
const NAV: NavItem[] = [
  { to: "/jobs", label: "Jobs", short: "Jobs", Icon: Table2, group: "work", tab: 1 },
  { to: "/board", label: "Board", short: "Board", Icon: Columns3, group: "work", tab: 5 },
  { to: "/applications", label: "Applications", short: "Applied", Icon: Send, group: "work", tab: 2 },
  { to: "/companies", label: "Companies", short: "Companies", Icon: Building2, group: "work", tab: 4 },
  // an add-on: shown only to accounts granted it (see supabase/migrations/0006_contacts.sql)
  { to: "/contacts", label: "Contacts", short: "Contacts", Icon: UsersRound, feature: "contacts", group: "work", tab: 3 },
  { to: "/activity", label: "Activity", short: "Activity", Icon: ActivityIcon, group: "insight", tab: 6 },
  { to: "/skills", label: "Skills", short: "Skills", Icon: GraduationCap, group: "insight" },
  { to: "/consumption", label: "Consumption", short: "Consumption", Icon: Gauge, group: "insight" },
  { to: "/runs", label: "Runs", short: "Runs", Icon: History, group: "insight" },
  { to: "/preferences", label: "Preferences", short: "Preferences", Icon: SlidersHorizontal, group: "you" },
  { to: "/settings", label: "Settings", short: "Settings", Icon: SettingsIcon, group: "you" },
];
const NAV_GROUPS: [NavItem["group"], string][] = [
  ["work", "Workspace"],
  ["insight", "Insights"],
  ["you", "You"],
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

/** Add-ons the signed-in account holds, e.g. ["contacts"]; null while they load. */
function useFeatures(signedIn: boolean): string[] | null {
  const [features, setFeatures] = useState<string[] | null>(null);
  useEffect(() => {
    if (!signedIn) return setFeatures(null);
    contactsApi.features().then(setFeatures, () => setFeatures([]));
  }, [signedIn]);
  return features;
}

/** A page from an add-on: waits for the account's add-ons, then shows the page or goes back to Jobs. */
function Gate({ feature, features, children }: { feature: string; features: string[] | null; children: React.ReactNode }) {
  if (features === null) return loading;
  if (!features.includes(feature)) return <Navigate to="/jobs" replace />;
  return <Suspense fallback={loading}>{children}</Suspense>;
}

export default function App() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const counts = useCounts(!!email);
  const features = useFeatures(!!email);
  const nav = NAV.filter((n) => !n.feature || !!features?.includes(n.feature));
  const contacts = !!features?.includes("contacts");

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
          {NAV_GROUPS.map(([group, title]) => (
            <div key={group} className="nav-group">
              <div className="nav-label">{title}</div>
              {nav
                .filter((n) => n.group === group)
                .map(({ to, label, Icon }) => {
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
            </div>
          ))}
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
        <Link to="/settings" className="btn quiet" aria-label="Settings">
          <SettingsIcon {...ICON} />
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
            <Route path="/applications" element={<Suspense fallback={loading}><Applications /></Suspense>} />
            <Route path="/companies" element={<Suspense fallback={loading}><Companies /></Suspense>} />
            <Route path="/activity" element={<Suspense fallback={loading}><Activity /></Suspense>} />
            <Route path="/preferences" element={<Suspense fallback={loading}><Preferences /></Suspense>} />
            <Route path="/settings" element={<Suspense fallback={loading}><Settings email={email} onSignOut={signOut} /></Suspense>} />
            <Route path="/contacts" element={<Gate feature="contacts" features={features}><Contacts /></Gate>} />
            <Route path="/contacts/import" element={<Gate feature="contacts" features={features}><ContactsImport /></Gate>} />
            <Route path="/contacts/settings" element={<Gate feature="contacts" features={features}><ContactsSettings /></Gate>} />
            <Route path="/contacts/:id" element={<Gate feature="contacts" features={features}><ContactDetail /></Gate>} />
            <Route path="*" element={<Navigate to="/jobs" replace />} />
          </Routes>
        </div>
      </main>

      <nav className="tabbar" aria-label="Pages">
        {/* five tabs fit a phone; the rest are in the search menu and the header's Settings button */}
        {nav
          .filter((n) => n.tab)
          .sort((a, b) => a.tab! - b.tab!)
          .slice(0, 5)
          .map(({ to, short, Icon }) => (
            <NavLink key={to} to={to}>
              <Icon {...ICON} size={20} />
              {short}
            </NavLink>
          ))}
      </nav>

      <CommandMenu onSignOut={signOut} contacts={contacts} />
    </div>
  );
}
