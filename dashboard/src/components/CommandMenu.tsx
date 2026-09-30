import {
  Activity,
  Building2,
  Columns3,
  CornerDownLeft,
  Gauge,
  GraduationCap,
  History,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Sun,
  Table2,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { applyTheme, currentTheme, THEME_LABEL, type Theme } from "../lib/theme";
import type { Job } from "../lib/types";
import { ICON, MatchScore, StatusIcon } from "./bits";

export const OPEN_EVENT = "fairsheet:cmdk";
export const openCommandMenu = () => window.dispatchEvent(new Event(OPEN_EVENT));

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

const THEME_ICON: Record<Theme, typeof Moon> = { dark: Moon, light: Sun, system: Monitor };

/** ⌘K: jump to any page or job, add a job, switch theme, sign out. */
export default function CommandMenu({ onSignOut, contacts = false }: { onSignOut?: () => void; contacts?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    returnFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, show);
    };
  }, [open, show, close]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (!jobs) api.listJobs().then(setJobs, () => setJobs([]));
  }, [open, jobs]);

  const go = useCallback(
    (to: string) => () => {
      setOpen(false);
      navigate(to);
    },
    [navigate],
  );

  const items = useMemo<Item[]>(() => {
    const base: Item[] = [
      { id: "p-jobs", group: "Go to", label: "Jobs", icon: <Table2 {...ICON} />, run: go("/jobs") },
      { id: "p-board", group: "Go to", label: "Board", icon: <Columns3 {...ICON} />, run: go("/board") },
      { id: "p-apps", group: "Go to", label: "Applications", icon: <Send {...ICON} />, keywords: "applied interviewing offer follow up tracker", run: go("/applications") },
      { id: "p-companies", group: "Go to", label: "Companies", icon: <Building2 {...ICON} />, keywords: "salary lpa pay targets boards", run: go("/companies") },
      ...(contacts
        ? [{ id: "p-contacts", group: "Go to", label: "Contacts", icon: <UsersRound {...ICON} />, keywords: "hr recruiters follow up whatsapp email", run: go("/contacts") }]
        : []),
      { id: "p-skills", group: "Go to", label: "Skills", icon: <GraduationCap {...ICON} />, keywords: "gaps learn", run: go("/skills") },
      { id: "p-usage", group: "Go to", label: "Consumption", icon: <Gauge {...ICON} />, keywords: "usage tokens money quota balance", run: go("/consumption") },
      { id: "p-runs", group: "Go to", label: "Runs", icon: <History {...ICON} />, keywords: "scans history", run: go("/runs") },
      { id: "p-activity", group: "Go to", label: "Activity", icon: <Activity {...ICON} />, keywords: "timeline history feed what happened", run: go("/activity") },
      { id: "p-prefs", group: "Go to", label: "Preferences", icon: <SlidersHorizontal {...ICON} />, keywords: "level roles cities remote salary emphasis", run: go("/preferences") },
      { id: "p-settings", group: "Go to", label: "Settings", icon: <Settings {...ICON} />, keywords: "ai model claude gemini ats review rounds account sign out", run: go("/settings") },
      { id: "a-add", group: "Actions", label: "Add a job", hint: "Paste a job the scans missed", icon: <Plus {...ICON} />, keywords: "new create", run: go("/add") },
      ...(["dark", "light", "system"] as Theme[])
        .filter((t) => t !== currentTheme())
        .map((t) => {
          const Icon = THEME_ICON[t];
          return {
            id: `t-${t}`,
            group: "Actions",
            label: `Theme: ${THEME_LABEL[t]}`,
            icon: <Icon {...ICON} />,
            keywords: "appearance dark light mode",
            run: () => {
              applyTheme(t);
              setOpen(false);
            },
          };
        }),
      ...(onSignOut
        ? [{ id: "a-out", group: "Actions", label: "Sign out", icon: <LogOut {...ICON} />, run: () => { setOpen(false); onSignOut(); } }]
        : []),
    ];
    const q = query.trim().toLowerCase();
    const matches = (s: string) => !q || s.toLowerCase().includes(q);
    const pages = base.filter((i) => matches(`${i.label} ${i.keywords ?? ""}`));
    const jobItems: Item[] = (jobs ?? [])
      .filter((j) => q && matches(`${j.title} ${j.company} ${j.location ?? ""}`))
      .sort((a, b) => (b.llm_score ?? -1) - (a.llm_score ?? -1))
      .slice(0, 8)
      .map((j) => ({
        id: `j-${j.id}`,
        group: "Jobs",
        label: `${j.title} · ${j.company}`,
        icon: <StatusIcon status={j.status} />,
        hint: String(j.llm_score ?? ""),
        run: go(`/jobs/${j.id}`),
      }));
    return q ? [...jobItems, ...pages] : pages;
  }, [query, jobs, go, onSignOut, contacts]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      e.preventDefault(); // focus stays in the search field; arrows move through results
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    }
  };

  let lastGroup = "";
  return (
    <div className="cmdk-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command menu" onKeyDown={onKeyDown}>
        <div className="cmdk-input">
          <Search {...ICON} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search jobs, pages and actions…"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={items[active] ? `cmdk-${items[active].id}` : undefined}
            aria-label="Search jobs, pages and actions"
          />
          <kbd>esc</kbd>
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" aria-label="Results">
          {items.map((item, i) => {
            const head = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {head && <div className="cmdk-group" role="presentation">{head}</div>}
                <div
                  id={`cmdk-${item.id}`}
                  className="cmdk-item"
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={item.run}
                >
                  {item.icon}
                  <span className="grow">{item.label}</span>
                  {item.group === "Jobs" ? (
                    <MatchScore score={item.hint ? Number(item.hint) : null} />
                  ) : (
                    item.hint && <span className="hint">{item.hint}</span>
                  )}
                  {i === active && (
                    <span className="hint" aria-hidden>
                      <CornerDownLeft {...ICON} size={12} />
                      {item.group === "Actions" ? "run" : "open"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {!items.length && <div className="cmdk-empty">Nothing matches “{query}”.</div>}
        </div>
        <div className="cmdk-foot" aria-hidden>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>
              <CornerDownLeft size={11} />
            </kbd>{" "}
            open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
