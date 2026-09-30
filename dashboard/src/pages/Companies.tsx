import { ExternalLink, Plus, Search, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, ICON, Notice, SkeletonRows } from "../components/bits";
import { api } from "../lib/api";
import { boardUrl, countBy, parseBoardUrl } from "../lib/companyMatch";
import { contactsApi } from "../lib/contacts/api";
import type { Job } from "../lib/types";
import { useTitle } from "../lib/useTitle";
import { workspaceApi, type Board, type Company, type CompanyInput } from "../lib/workspace";

const BOARD_LABEL: Record<Board, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby" };
const OPEN = new Set(["new", "shortlisted", "tailor_queued", "tailored"]);
type Sort = "pay" | "name" | "jobs";

const BLANK: CompanyInput = {
  name: "",
  category: null,
  salary_min_lpa: null,
  salary_max_lpa: null,
  salary_source: null,
  careers_url: null,
  board: null,
  board_slug: null,
  target: false,
  notes: null,
};

function lpa(c: Pick<Company, "salary_min_lpa" | "salary_max_lpa">): string {
  const { salary_min_lpa: lo, salary_max_lpa: hi } = c;
  if (lo == null && hi == null) return "";
  if (lo != null && hi != null) return lo === hi ? `${lo}` : `${lo}–${hi}`;
  return `${lo ?? hi}`;
}

/** One company's bracket on the shared 0–axis LPA scale: a single neutral range mark, figures in text ink. */
function SalaryRange({ c, axis }: { c: Company; axis: number }) {
  const lo = c.salary_min_lpa ?? c.salary_max_lpa;
  const hi = c.salary_max_lpa ?? c.salary_min_lpa;
  if (lo == null || hi == null) return <span className="muted">Not known</span>;
  const tip = `${lpa(c)} LPA${c.salary_source ? `, per ${c.salary_source}` : ""}`;
  return (
    <div className="salary" title={tip}>
      <span className="num salary-figure">{lpa(c)}</span>
      <span className="range-track" aria-hidden>
        <span className="range-mark" style={{ left: `${(lo / axis) * 100}%`, width: `${Math.max(((hi - lo) / axis) * 100, 1.5)}%` }} />
      </span>
    </div>
  );
}

function Editor({ initial, onSave, onDelete, onCancel }: {
  initial: CompanyInput & { id?: string };
  onSave: (c: CompanyInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}) {
  const [c, setC] = useState(initial);
  const [boardLink, setBoardLink] = useState(boardUrl(initial.board, initial.board_slug) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <form
      className="form company-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = boardLink.trim() ? parseBoardUrl(boardLink) : null;
        if (boardLink.trim() && !parsed) return setError("That is not a Greenhouse, Lever or Ashby board link.");
        if (c.salary_min_lpa != null && c.salary_max_lpa != null && c.salary_max_lpa < c.salary_min_lpa)
          return setError("The top of the bracket is below the bottom.");
        setBusy(true);
        try {
          await onSave({ ...c, name: c.name.trim(), board: parsed?.board ?? null, board_slug: parsed?.slug ?? null });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setBusy(false);
        }
      }}
    >
      {error && <Notice kind="error" onClose={() => setError(null)}>{error}</Notice>}
      <div className="two">
        <label>
          Company
          <input required value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="e.g. Qualys" />
        </label>
        <label>
          Kind of company
          <input value={c.category ?? ""} onChange={(e) => setC({ ...c, category: e.target.value || null })} placeholder="e.g. Fintech" />
        </label>
      </div>
      <div className="two">
        <label>
          Salary from (LPA)
          <input type="number" min={0} step="any" value={c.salary_min_lpa ?? ""} onChange={(e) => setC({ ...c, salary_min_lpa: num(e.target.value) })} />
        </label>
        <label>
          Salary to (LPA)
          <input type="number" min={0} step="any" value={c.salary_max_lpa ?? ""} onChange={(e) => setC({ ...c, salary_max_lpa: num(e.target.value) })} />
        </label>
      </div>
      <div className="two">
        <label>
          Salary source
          <input value={c.salary_source ?? ""} onChange={(e) => setC({ ...c, salary_source: e.target.value || null })} placeholder="e.g. levels.fyi, a recruiter call" />
        </label>
        <label>
          Careers page
          <input value={c.careers_url ?? ""} onChange={(e) => setC({ ...c, careers_url: e.target.value || null })} placeholder="https://" />
        </label>
      </div>
      <label>
        Job board to scan
        <input value={boardLink} onChange={(e) => setBoardLink(e.target.value)} placeholder="https://job-boards.greenhouse.io/remotecom" />
        <span className="hint">A Greenhouse, Lever or Ashby board link. Each scan (10:00 and 22:00 IST) reads its openings directly, free.</span>
      </label>
      <label>
        Notes
        <input value={c.notes ?? ""} onChange={(e) => setC({ ...c, notes: e.target.value || null })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={c.target} onChange={(e) => setC({ ...c, target: e.target.checked })} />
        A target: I want to work here
      </label>
      <div className="form-actions">
        <button className="btn primary" type="submit" disabled={busy || !c.name.trim()}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn quiet" type="button" onClick={onCancel}>
          Cancel
        </button>
        {onDelete && (
          <button
            className="btn danger"
            type="button"
            style={{ marginLeft: "auto" }}
            onClick={async () => {
              if (!confirm(`Remove ${c.name} from your companies? Its jobs and contacts stay.`)) return;
              setBusy(true);
              await onDelete().catch((err) => {
                setError(String(err?.message ?? err));
                setBusy(false);
              });
            }}
          >
            Remove
          </button>
        )}
      </div>
    </form>
  );
}

export default function Companies() {
  useTitle("Companies");
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [contactNames, setContactNames] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [targetsOnly, setTargetsOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("pay");
  const [editing, setEditing] = useState<string | null>(null); // company id, or "new"

  useEffect(() => {
    workspaceApi.companies().then(setCompanies, (e: Error) => setError(e.message));
    api.listJobs().then(setJobs, () => setJobs([]));
    contactsApi
      .features()
      .then(async (f) => {
        if (!f.includes("contacts")) return;
        const [cos, people] = await Promise.all([contactsApi.companies(), contactsApi.contacts()]);
        const byId = new Map(cos.map((c) => [c.id, c.name]));
        setContactNames(people.map((p) => (p.company_id ? byId.get(p.company_id) ?? "" : "")));
      })
      .catch(() => undefined);
  }, []);

  const names = useMemo(() => (companies ?? []).map((c) => c.name), [companies]);
  const jobsBy = useMemo(() => countBy(names, jobs, (j) => j.company), [names, jobs]);
  const contactsBy = useMemo(() => (contactNames ? countBy(names, contactNames, (n) => n) : null), [names, contactNames]);
  const categories = useMemo(() => [...new Set((companies ?? []).map((c) => c.category).filter(Boolean) as string[])].sort(), [companies]);
  const axis = Math.max(90, ...(companies ?? []).map((c) => c.salary_max_lpa ?? 0));

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (companies ?? []).filter(
      (c) =>
        (!needle || c.name.toLowerCase().includes(needle) || (c.category ?? "").toLowerCase().includes(needle)) &&
        (!category || c.category === category) &&
        (!targetsOnly || c.target),
    );
    const openJobs = (c: Company) => (jobsBy.get(c.name) ?? []).filter((j) => OPEN.has(j.status)).length;
    return list.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "jobs"
          ? openJobs(b) - openJobs(a) || a.name.localeCompare(b.name)
          : (b.salary_max_lpa ?? -1) - (a.salary_max_lpa ?? -1) || (b.salary_min_lpa ?? -1) - (a.salary_min_lpa ?? -1) || a.name.localeCompare(b.name),
    );
  }, [companies, q, category, targetsOnly, sort, jobsBy]);

  const withJobs = (companies ?? []).filter((c) => (jobsBy.get(c.name) ?? []).length > 0).length;
  const boards = (companies ?? []).filter((c) => c.board).length;
  const targets = (companies ?? []).filter((c) => c.target).length;
  const cols = contactsBy ? 7 : 6;

  const save = async (id: string | null, input: CompanyInput) => {
    const row = await workspaceApi.saveCompany(id, input);
    setCompanies((prev) => (id ? (prev ?? []).map((c) => (c.id === id ? row : c)) : [...(prev ?? []), row]));
    setEditing(null);
  };
  const toggleTarget = async (c: Company) => {
    setCompanies((prev) => (prev ?? []).map((x) => (x.id === c.id ? { ...x, target: !c.target } : x)));
    await workspaceApi.saveCompany(c.id, { target: !c.target }).catch((e: Error) => setError(e.message));
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Companies</h1>
          <p className="lede">
            Where you want to work and what they pay. Brackets are in lakh per annum (LPA) for India, from{" "}
            <a href="https://www.instagram.com/hey.aanchal/" target="_blank" rel="noreferrer">
              hey.aanchal on Instagram
            </a>{" "}
            unless you changed them. Compensation varies with role, experience, location and skills.
          </p>
        </div>
        <button className="btn primary" onClick={() => setEditing("new")} disabled={editing === "new"}>
          <Plus {...ICON} size={14} />
          Add a company
        </button>
      </div>
      {error && (
        <Notice kind="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}

      {companies && (
        <dl className="ledger" aria-label="Companies summary">
          <div>
            <dt>Companies</dt>
            <dd>{companies.length}</dd>
          </div>
          <div>
            <dt>Targets</dt>
            <dd>{targets}</dd>
          </div>
          <div>
            <dt>In your tracker</dt>
            <dd>
              {withJobs}
              <span className="small">with jobs</span>
            </dd>
          </div>
          <div>
            <dt>Boards scanned</dt>
            <dd>{boards}</dd>
          </div>
        </dl>
      )}

      {editing === "new" && (
        <section className="panel panel-pad" style={{ margin: "16px 0" }} aria-label="Add a company">
          <Editor initial={BLANK} onSave={(c) => save(null, c)} onCancel={() => setEditing(null)} />
        </section>
      )}

      <div className="filters" role="search">
        <label className="grow">
          <span className="visually-hidden">Find a company</span>
          <Search {...ICON} size={14} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a company or kind" />
        </label>
        <select className="compact" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kind of company">
          <option value="">Every kind</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select className="compact" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
          <option value="pay">Highest pay first</option>
          <option value="jobs">Most open jobs first</option>
          <option value="name">A to Z</option>
        </select>
        <button className="btn small" aria-pressed={targetsOnly} onClick={() => setTargetsOnly(!targetsOnly)}>
          <Star {...ICON} size={14} />
          Targets only
        </button>
      </div>

      <div className="panel table-wrap">
        <table className="entries companies">
          <thead>
            <tr>
              <th className="star-col">
                <span className="visually-hidden">Target</span>
              </th>
              <th>Company</th>
              <th>Salary, LPA (scale 0 to {axis})</th>
              <th className="right">Jobs</th>
              {contactsBy && <th className="right">Contacts</th>}
              <th>Job board</th>
              <th>
                <span className="visually-hidden">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!companies && <SkeletonRows cols={cols} rows={8} />}
            {shown.map((c) => {
              const cJobs = jobsBy.get(c.name) ?? [];
              const open = cJobs.filter((j) => OPEN.has(j.status)).length;
              const people = contactsBy?.get(c.name)?.length ?? 0;
              const url = boardUrl(c.board, c.board_slug);
              if (editing === c.id)
                return (
                  <tr key={c.id} className="editing">
                    <td colSpan={cols}>
                      <Editor
                        initial={c}
                        onSave={(input) => save(c.id, input)}
                        onDelete={async () => {
                          await workspaceApi.deleteCompany(c.id);
                          setCompanies((prev) => (prev ?? []).filter((x) => x.id !== c.id));
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    </td>
                  </tr>
                );
              return (
                <tr key={c.id}>
                  <td className="star-col only-wide">
                    <button
                      className={`icon-btn star-toggle${c.target ? " on" : ""}`}
                      onClick={() => toggleTarget(c)}
                      aria-pressed={c.target}
                      aria-label={c.target ? `${c.name} is a target; unmark` : `Mark ${c.name} as a target`}
                      title={c.target ? "A target" : "Mark as a target"}
                    >
                      <Star {...ICON} size={15} />
                    </button>
                  </td>
                  <td className="cell-role">
                    <div className="c-company">
                      {c.target && <Star {...ICON} size={13} className="icon star only-narrow" aria-label="Target" />}
                      <span className="role-title">{c.name}</span>
                    </div>
                    <div className="role-sub">{[c.category, c.notes].filter(Boolean).join(" · ") || " "}</div>
                  </td>
                  <td className="cell-status salary-cell">
                    <SalaryRange c={c} axis={axis} />
                  </td>
                  <td className="right num cell-scores">
                    {cJobs.length ? (
                      <Link to={`/jobs?q=${encodeURIComponent(c.name)}`} title={`${open} open, ${cJobs.length} in all`}>
                        {open}
                        <span className="muted"> / {cJobs.length}</span>
                      </Link>
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </td>
                  {contactsBy && (
                    <td className="right num only-wide">
                      {people ? <Link to={`/contacts?q=${encodeURIComponent(c.name)}`}>{people}</Link> : <span className="muted">0</span>}
                    </td>
                  )}
                  <td className="only-wide small">
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer" title="Scanned twice a day">
                        {BOARD_LABEL[c.board!]}: {c.board_slug}
                        <ExternalLink {...ICON} size={12} />
                      </a>
                    ) : c.careers_url ? (
                      <a href={c.careers_url} target="_blank" rel="noreferrer">
                        Careers page
                        <ExternalLink {...ICON} size={12} />
                      </a>
                    ) : (
                      <span className="muted">None yet</span>
                    )}
                  </td>
                  <td className="act">
                    <button className="btn quiet small" onClick={() => setEditing(c.id)} aria-label={`Edit ${c.name}`}>
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {companies && shown.length === 0 && (
          <Empty title={companies.length ? "No company matches" : "No companies yet"}>
            {companies.length
              ? "Clear the search or the filters to see them all."
              : "Add the companies you want to work at, with what they pay and their job board, and the bot scans their openings twice a day."}
          </Empty>
        )}
      </div>
      <p className="xs muted footnote">
        Jobs counts open jobs (new, shortlisted, queued or with a resume ready) over every job the tracker has saved for the company.
      </p>
    </>
  );
}
