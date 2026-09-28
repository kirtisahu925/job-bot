import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Empty, Notice, SkeletonRows } from "../components/bits";
import { api } from "../lib/api";
import {
  SKILL_CHOICE_LABEL,
  type Job,
  type ProfileSnapshot,
  type SkillChoice,
  type SkillDemand,
  type SkillStatus,
} from "../lib/types";
import { useTitle } from "../lib/useTitle";

const TRACK: Record<string, string> = { java: "Java", python: "Python", fullstack: "Full-stack" };

function Demand({ n, of }: { n: number; of: number }) {
  return (
    <div className="row" style={{ flexWrap: "nowrap", gap: 10 }}>
      <span className="num" style={{ minWidth: 64 }}>
        {n} <span className="muted">of {of}</span>
      </span>
      <div className="meter" style={{ flex: 1, minWidth: 70, maxWidth: 160 }} aria-hidden>
        <span style={{ width: `${of ? Math.max((n / of) * 100, n ? 2 : 0) : 0}%` }} />
      </div>
    </div>
  );
}

export default function Skills() {
  useTitle("Skills");
  const [profile, setProfile] = useState<ProfileSnapshot | null | undefined>(undefined);
  const [statuses, setStatuses] = useState<SkillStatus[]>([]);
  const [demand, setDemand] = useState<SkillDemand[] | null>(null);
  const [total, setTotal] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const { hash } = useLocation();

  useEffect(() => {
    Promise.all([api.profileSnapshot(), api.skillStatuses(), api.skillDemand(), api.jobsWithKeywords(), api.listJobs()]).then(
      ([p, s, d, t, j]) => {
        setProfile(p);
        setStatuses(s);
        setDemand(d);
        setTotal(t);
        setJobs(j);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  useEffect(() => {
    if (!hash || !demand) return;
    document.getElementById(`skill-${decodeURIComponent(hash.slice(1))}`)?.scrollIntoView({ block: "center" });
  }, [hash, demand]);

  const choice = useMemo(() => new Map(statuses.map((s) => [s.skill.toLowerCase(), s.status])), [statuses]);
  const byKey = useMemo(() => new Map((demand ?? []).map((d) => [d.skill_key, d])), [demand]);
  const jobTitle = useMemo(() => new Map(jobs.map((j) => [j.id, `${j.title}, ${j.company}`])), [jobs]);

  const category = useMemo(() => {
    const m = new Map<string, string>();
    for (const [cat, list] of Object.entries(profile?.categories ?? {})) for (const s of list) m.set(s.toLowerCase(), cat);
    return m;
  }, [profile]);

  const mine = useMemo(() => {
    const names = new Map<string, string>();
    for (const s of profile?.skills ?? []) names.set(s.toLowerCase(), s);
    for (const s of statuses) if (s.status === "known") names.set(s.skill.toLowerCase(), s.skill);
    return [...names].map(([key, skill]) => ({
      key,
      skill,
      category: category.get(key) ?? (choice.get(key) === "known" ? "Marked as known" : "Profile"),
      required: byKey.get(key)?.required_by ?? 0,
      preferred: byKey.get(key)?.preferred_by ?? 0,
    })).sort((a, b) => b.required - a.required || b.preferred - a.preferred || a.skill.localeCompare(b.skill));
  }, [profile, statuses, byKey, category, choice]);

  const mineKeys = useMemo(() => new Set(mine.map((m) => m.key)), [mine]);
  const gaps = (demand ?? [])
    .filter((d) => !mineKeys.has(d.skill_key) && choice.get(d.skill_key) !== "ignore")
    .sort((a, b) => b.required_by - a.required_by || b.jobs - a.jobs || a.skill.localeCompare(b.skill));
  const ignored = (demand ?? []).filter((d) => choice.get(d.skill_key) === "ignore");

  const set = async (skill: string, status: SkillChoice | null) => {
    setSaving(skill);
    try {
      await api.setSkillStatus(skill, status);
      setStatuses((prev) => [
        ...prev.filter((s) => s.skill.toLowerCase() !== skill.toLowerCase()),
        ...(status ? [{ skill, status, note: null, updated_at: new Date().toISOString() }] : []),
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const loading = demand === null;
  const top = gaps[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Skills</h1>
          <p className="lede">
            {loading
              ? "Counting what the scanned jobs ask for…"
              : total === 0
                ? "No job has extracted keywords yet; they arrive with the next scan."
                : `Across ${total} jobs with extracted keywords: you list ${mine.length} skills, and ${gaps.length} skills you don't list come up.` +
                  (top ? ` The most requested gap is ${top.skill}, required by ${top.required_by}.` : "")}
          </p>
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}

      <section className="section" aria-labelledby="gaps-h" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h2 id="gaps-h">Gaps: skills to learn</h2>
          <span className="muted small">"I know this" moves a skill to your list; the bot then may name it in your resume's Skills section, never as invented experience.</span>
        </div>
        <div className="panel table-wrap">
          <table className="entries">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Required by</th>
                <th className="right hide-sm">Preferred by</th>
                <th className="hide-sm">Tracks</th>
                <th className="hide-sm">Jobs asking</th>
                <th>Your plan</th>
              </tr>
            </thead>
            <tbody>
              {loading && <SkeletonRows cols={6} rows={5} />}
              {gaps.map((d) => (
                <tr key={d.skill_key} id={`skill-${d.skill_key}`} style={hash === `#${encodeURIComponent(d.skill_key)}` ? { background: "var(--accent-wash)" } : undefined}>
                  <td className="cell-role" style={{ fontWeight: 600 }}>{d.skill}</td>
                  <td className="cell-status">
                    <Demand n={d.required_by} of={total} />
                  </td>
                  <td className="right num hide-sm only-wide">{d.preferred_by}</td>
                  <td className="hide-sm only-wide soft">{d.tracks.map((t) => TRACK[t] ?? t).join(", ") || "–"}</td>
                  <td className="hide-sm only-wide small">
                    {d.example_job_ids.slice(0, 2).map((id) => (
                      <div key={id}>
                        <Link to={`/jobs/${id}`}>{jobTitle.get(id) ?? "Open job"}</Link>
                      </div>
                    ))}
                    {d.jobs > 2 && <span className="muted">and {d.jobs - 2} more</span>}
                  </td>
                  <td className="act">
                    <select
                      className="compact"
                      value={choice.get(d.skill_key) ?? ""}
                      disabled={saving === d.skill}
                      onChange={(e) => set(d.skill, (e.target.value || null) as SkillChoice | null)}
                      aria-label={`Your plan for ${d.skill}`}
                    >
                      <option value="">Not decided</option>
                      {(Object.keys(SKILL_CHOICE_LABEL) as SkillChoice[]).map((c) => (
                        <option key={c} value={c}>
                          {SKILL_CHOICE_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && gaps.length === 0 && (
            <Empty title={total ? "No gaps in the scanned jobs" : "No gaps counted yet"}>
              {total
                ? "Every skill the scanned jobs ask for is on your list. New scans can still add some."
                : "Each scan extracts the required and preferred skills of every job; the ones your profile lacks are ranked here."}
            </Empty>
          )}
        </div>
      </section>

      <section className="section" aria-labelledby="mine-h">
        <div className="section-head">
          <h2 id="mine-h">Your skills</h2>
          <span className="muted small">
            From your master profile{profile?.updated_at ? `, synced ${new Date(profile.updated_at).toLocaleDateString("en-IN")}` : ""}.
            Edit <code>profile/master_profile.yaml</code> to change them.
          </span>
        </div>
        <div className="panel table-wrap">
          <table className="entries">
            <thead>
              <tr>
                <th>Skill</th>
                <th className="hide-sm">Group</th>
                <th>Required by</th>
                <th className="right hide-sm">Preferred by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {profile === undefined && <SkeletonRows cols={5} rows={5} />}
              {mine.map((m) => (
                <tr key={m.key}>
                  <td className="cell-role" style={{ fontWeight: 600 }}>
                    {m.skill}
                    <div className="only-narrow soft small" style={{ fontWeight: 400 }}>
                      {m.category}
                    </div>
                  </td>
                  <td className="hide-sm only-wide soft">{m.category}</td>
                  <td className="cell-status">
                    <Demand n={m.required} of={total} />
                  </td>
                  <td className="right num hide-sm only-wide">{m.preferred}</td>
                  <td className="right act">
                    {choice.get(m.key) === "known" && (
                      <button className="btn quiet small" onClick={() => set(m.skill, null)} disabled={saving === m.skill}>
                        Undo "I know this"
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {profile === null && (
            <Empty title="Your profile has not been synced yet">
              The bot copies the skills from your master profile into the tracker at the start of every run.
            </Empty>
          )}
        </div>
      </section>

      {ignored.length > 0 && (
        <section className="section" aria-labelledby="ign-h">
          <h2 id="ign-h">Ignored ({ignored.length})</h2>
          <div className="tags">
            {ignored.map((d) => (
              <button key={d.skill_key} className="tag" style={{ cursor: "pointer" }} onClick={() => set(d.skill, null)} title="Show it among the gaps again">
                {d.skill} <span className="muted">restore</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
