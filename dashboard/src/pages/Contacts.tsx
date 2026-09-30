import { Plus, Search, Settings2, Star, Upload } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Empty, ICON, MetaLine, Notice } from "../components/bits";
import { ChannelDots, ChannelIcon, ContactStatusPill, DueTag } from "../components/contacts";
import { api } from "../lib/api";
import { contactsApi } from "../lib/contacts/api";
import { channelsFor, dueLabel, STATUS_LABEL, type ContactStatus } from "../lib/contacts/cadence";
import { displayName, KIND_LABEL } from "../lib/contacts/model";
import type { ContactKind } from "../lib/contacts/parse";
import { leaderSearchLinks } from "../lib/contacts/templates";
import { companyKey, useContacts, type Row } from "../lib/contacts/useContacts";
import type { Job } from "../lib/types";
import { useTitle } from "../lib/useTitle";

const VIEWS = [
  { id: "due", label: "Due" },
  { id: "all", label: "By company" },
  { id: "companies", label: "Companies" },
] as const;
type View = (typeof VIEWS)[number]["id"];

const DAY = 86_400_000;
const ACTIVE: ContactStatus[] = ["new", "reaching_out", "in_touch", "interviewing"];

export function Playbook() {
  return (
    <details className="panel playbook">
      <summary>How to follow up</summary>
      <ol>
        <li>
          Follow up actively, every 2-3 days. Start on <strong>LinkedIn</strong> (an invite, or an InMail if you have Premium); if they
          do not accept or reply, send a <strong>cold e-mail</strong>; then a <strong>WhatsApp</strong> message; if none of the three
          work, <strong>call</strong>. The Due list follows this order for every contact and skips channels you have no details for.
        </li>
        <li>
          When HR calls and asks your availability, say yes to a <strong>face-to-face interview</strong> and let them schedule it around
          you. Asking for a virtual round can get you deprioritised, or rejected on that basis.
        </li>
        <li>
          At target companies (marked with a star, like Qualys) also reach <strong>Directors, VPs and Managers</strong>: find them from
          the company page and send an invite saying you are interested in the company and asking about relevant roles.
        </li>
      </ol>
    </details>
  );
}

function ContactRow({ row, now }: { row: Row; now: Date }) {
  const { contact: c, company, next } = row;
  const name = displayName(c, company?.name);
  return (
    <Link to={`/contacts/${c.id}`} className="crow" role="listitem">
      <span className="c-next">{next.channel ? <ChannelIcon channel={next.channel} /> : null}</span>
      <span className="c-who">
        <span className="c-name">
          {name}
          {company?.target && <Star {...ICON} size={12} className="icon star" aria-label="Target company" />}
        </span>
        <span className="c-sub">
          {[c.name ? c.role : KIND_LABEL[c.kind], company?.name, c.location].filter(Boolean).join(" · ") || "Company not named"}
        </span>
      </span>
      <span className="c-step">
        <span className="c-action">{next.action}</span>
        <span className="c-why">{next.why}</span>
      </span>
      <span className="c-due">
        <DueTag label={next.due ? dueLabel(next.due, now) : ""} />
      </span>
      <span className="c-status">
        <ContactStatusPill status={c.status} />
      </span>
      <span className="c-channels">
        <ChannelDots have={channelsFor({ ...c, company: company?.name })} />
      </span>
    </Link>
  );
}

export default function Contacts() {
  useTitle("Contacts");
  const navigate = useNavigate();
  const { data, rows, error, reload } = useContacts();
  const [view, setView] = useState<View>("due");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<ContactKind | "all">("all");
  const [status, setStatus] = useState<ContactStatus | "active" | "all">("active");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [newCompany, setNewCompany] = useState("");
  const now = useMemo(() => new Date(), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.listJobs().then(setJobs, () => setJobs([]));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return rows
      .filter((r) => kind === "all" || r.contact.kind === kind)
      .filter((r) => (status === "all" ? true : status === "active" ? ACTIVE.includes(r.contact.status) : r.contact.status === status))
      .filter((r) => {
        if (!needle) return true;
        const hay = `${r.contact.name ?? ""} ${r.company?.name ?? ""} ${r.contact.role} ${r.contact.emails.join(" ")} ${r.contact.notes ?? ""} ${r.contact.labels.join(" ")}`.toLowerCase();
        return hay.includes(needle) || (digits.length >= 4 && r.contact.phones.some((p) => p.number.includes(digits)));
      });
  }, [rows, q, kind, status]);

  const due = useMemo(
    () =>
      filtered
        .filter((r) => r.next.due && r.next.due.getTime() <= now.getTime() + 3 * DAY)
        .sort((a, b) => Number(!!b.company?.target) - Number(!!a.company?.target) || a.next.due!.getTime() - b.next.due!.getTime()),
    [filtered, now],
  );
  const dueNow = due.filter((r) => r.next.due!.getTime() <= now.getTime() || dueLabel(r.next.due, now) === "today");
  const dueSoon = due.filter((r) => !dueNow.includes(r));

  const byCompany = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const r of filtered) {
      const key = r.company?.name ?? "";
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return [...groups.entries()].sort(
      ([a, ra], [b, rb]) =>
        Number(!!rb[0].company?.target) - Number(!!ra[0].company?.target) || (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b),
    );
  }, [filtered]);

  const jobsByCompany = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) if (!["rejected", "expired", "skipped", "archived"].includes(j.status)) m.set(companyKey(j.company), (m.get(companyKey(j.company)) ?? 0) + 1);
    return m;
  }, [jobs]);

  const toggleTarget = async (id: string, target: boolean) => {
    await contactsApi.updateCompany(id, { target });
    await reload();
  };

  const counts = {
    due: rows.filter((r) => r.next.due && (r.next.due.getTime() <= now.getTime() || dueLabel(r.next.due, now) === "today")).length,
    all: rows.length,
    companies: data?.companies.length ?? 0,
  };
  const inTouch = rows.filter((r) => r.contact.status === "in_touch").length;
  const interviewing = rows.filter((r) => r.contact.status === "interviewing").length;
  const reachedWeek = new Set(
    (data?.touches ?? []).filter((t) => now.getTime() - Date.parse(t.at) < 7 * DAY).map((t) => t.contact_id),
  ).size;

  return (
    <>
      <div className="bar">
        <h1>Contacts</h1>
        <div className="tabs" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
              {v.label}
              <span className="count">{data ? counts[v.id] : ""}</span>
            </button>
          ))}
        </div>
        <span className="spacer" />
        <MetaLine
          label="Outreach"
          cells={[
            { term: "Reached this week", value: data ? reachedWeek : "…" },
            { term: "In touch", value: data ? inTouch : "…" },
            { term: "Interviewing", value: data ? interviewing : "…" },
          ]}
        />
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <div className="filters" role="search">
        <label className="grow">
          <span className="visually-hidden">Search contacts</span>
          <Search {...ICON} size={14} />
          <input type="search" placeholder="Search name, company, number or e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select value={kind} onChange={(e) => setKind(e.target.value as ContactKind | "all")} aria-label="Kind">
          <option value="all">Everyone</option>
          {Object.entries(KIND_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as ContactStatus | "active" | "all")} aria-label="Status">
          <option value="active">Open (not closed)</option>
          <option value="all">Every status</option>
          {Object.entries(STATUS_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <Link to="/contacts/import" className="btn small">
          <Upload {...ICON} size={14} />
          Import
        </Link>
        <Link to="/contacts/import#add" className="btn small">
          <Plus {...ICON} size={14} />
          Add
        </Link>
        <Link to="/contacts/settings" className="btn small quiet" aria-label="Your details for messages">
          <Settings2 {...ICON} size={14} />
        </Link>
      </div>

      <Playbook />

      {!data && !error && <p className="muted">Loading contacts…</p>}

      {data && view === "due" && (
        <div className="list clist" role="list">
          {dueNow.length > 0 && (
            <div className="group-head">
              Today and overdue <span className="count">{dueNow.length}</span>
            </div>
          )}
          {dueNow.map((r) => (
            <ContactRow key={r.contact.id} row={r} now={now} />
          ))}
          {dueSoon.length > 0 && (
            <div className="group-head">
              Next 3 days <span className="count">{dueSoon.length}</span>
            </div>
          )}
          {dueSoon.map((r) => (
            <ContactRow key={r.contact.id} row={r} now={now} />
          ))}
          {!due.length && (
            <Empty title="Nothing due">
              Every open contact has been followed up within the last {data.settings?.cadence_days ?? 2} days. New contacts appear here as
              soon as you add them.
            </Empty>
          )}
        </div>
      )}

      {data && view === "all" && (
        <div className="list clist" role="list">
          {byCompany.map(([name, list]) => (
            <Fragment key={name || "none"}>
              <div className="group-head">
                {list[0].company?.target && <Star {...ICON} size={13} className="icon star" aria-label="Target company" />}
                {name || "Company not named"}
                <span className="count">{list.length}</span>
                {!!jobsByCompany.get(companyKey(name)) && (
                  <Link className="group-link" to={`/jobs?q=${encodeURIComponent(name)}`}>
                    {jobsByCompany.get(companyKey(name))} open job{jobsByCompany.get(companyKey(name)) === 1 ? "" : "s"}
                  </Link>
                )}
              </div>
              {list.map((r) => (
                <ContactRow key={r.contact.id} row={r} now={now} />
              ))}
            </Fragment>
          ))}
          {!byCompany.length && <Empty title="No contacts match">Clear the search or the filters.</Empty>}
        </div>
      )}

      {data && view === "companies" && (
        <div className="panel">
          <div className="table-wrap">
            <table className="entries">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <span className="visually-hidden">Target</span>
                  </th>
                  <th>Company</th>
                  <th className="right">Contacts</th>
                  <th className="right">Reached</th>
                  <th className="right">In touch</th>
                  <th className="right">Open jobs</th>
                  <th>Leaders on LinkedIn</th>
                </tr>
              </thead>
              <tbody>
                {[...data.companies]
                  .filter((co) => !q || co.name.toLowerCase().includes(q.trim().toLowerCase()))
                  .sort((a, b) => Number(b.target) - Number(a.target) || a.name.localeCompare(b.name))
                  .map((co) => {
                    const people = rows.filter((r) => r.contact.company_id === co.id);
                    const jobsCount = jobsByCompany.get(companyKey(co.name)) ?? 0;
                    return (
                      <tr key={co.id}>
                        <td>
                          <button
                            className={`icon-btn star-toggle${co.target ? " on" : ""}`}
                            aria-pressed={co.target}
                            aria-label={co.target ? `Stop targeting ${co.name}` : `Target ${co.name}`}
                            title={co.target ? "Target company: reach its leaders too" : "Mark as a target company"}
                            onClick={() => toggleTarget(co.id, !co.target)}
                          >
                            <Star {...ICON} size={14} />
                          </button>
                        </td>
                        <td className="cell-role">
                          <button className="linkish" onClick={() => {
                            setView("all");
                            setQ(co.name);
                          }}>
                            {co.name}
                          </button>
                          {co.notes && <div className="muted xs">{co.notes}</div>}
                        </td>
                        <td className="right num">{people.length}</td>
                        <td className="right num">{people.filter((r) => r.touches.length).length}</td>
                        <td className="right num">{people.filter((r) => r.contact.status === "in_touch" || r.contact.status === "interviewing").length}</td>
                        <td className="right num">
                          {jobsCount ? <Link to={`/jobs?q=${encodeURIComponent(co.name)}`}>{jobsCount}</Link> : <span className="muted">0</span>}
                        </td>
                        <td>
                          {co.target ? (
                            <span className="row" style={{ gap: 10 }}>
                              {leaderSearchLinks(co.name, co.linkedin_url).map((l) => (
                                <a key={l.label} href={l.url} target="_blank" rel="noreferrer">
                                  {l.label}
                                </a>
                              ))}
                            </span>
                          ) : (
                            <span className="muted xs">Star it to find leaders</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <form
            className="panel-pad row"
            style={{ borderTop: "1px solid var(--line)", gap: 8 }}
            onSubmit={async (e) => {
              e.preventDefault();
              const name = newCompany.trim();
              if (!name) return;
              const co = await contactsApi.addCompany(name, { target: true });
              setNewCompany("");
              await reload();
              navigate(`/contacts/import?company=${encodeURIComponent(co.name)}#add`);
            }}
          >
            <label className="grow">
              <span className="visually-hidden">Target company name</span>
              <input value={newCompany} onChange={(e) => setNewCompany(e.target.value)} placeholder="Add a target company, e.g. Qualys" />
            </label>
            <button className="btn small" type="submit" disabled={!newCompany.trim()}>
              <Plus {...ICON} size={14} />
              Add and find people
            </button>
          </form>
        </div>
      )}
    </>
  );
}
