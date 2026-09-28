import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { AlertTriangle, Check, Clock, Minus, X } from "lucide-react";
import { ICON, LowFlag, Meter, Notice } from "../components/bits";
import { api } from "../lib/api";
import { amount, ago, compact, daysAgoIst, inr, istDay, providerLabel, sourceLabel, usd } from "../lib/format";
import type { ApiUsageDay, Balance, CreditBalance, Run, Topup, UsageDay } from "../lib/types";
import { useTitle } from "../lib/useTitle";

const RANGES = [
  { label: "Today", days: 0 },
  { label: "Last 7 days", days: 6 },
  { label: "Last 30 days", days: 29 },
  { label: "Month to date", days: -1 },
];

// The table view keeps the split; the chart draws one ink (total tokens), the split is in its tooltip.
const PARTS = [
  { key: "input_tokens", label: "Input" },
  { key: "output_tokens", label: "Output" },
  { key: "thinking_tokens", label: "Thinking" },
] as const;

const HEALTH: Record<string, { cls: string; icon: JSX.Element; label: string }> = {
  ok: { cls: "ok", icon: <Check {...ICON} size={14} />, label: "Worked" },
  empty: { cls: "warn", icon: <span className="small">0</span>, label: "No results" },
  blocked: { cls: "warn", icon: <AlertTriangle {...ICON} size={13} />, label: "Blocked or rate-limited" },
  broken: { cls: "bad", icon: <X {...ICON} size={14} />, label: "Broken (site changed)" },
  error: { cls: "bad", icon: <X {...ICON} size={14} />, label: "Error" },
  timeout: { cls: "bad", icon: <Clock {...ICON} size={13} />, label: "Timed out" },
  skipped: { cls: "off", icon: <Minus {...ICON} size={14} />, label: "Skipped (no key)" },
};

interface Row {
  provider: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  unit: string;
  period: string;
  source: string;
  checked: string | null;
  note: string | null;
}

function monthStartIst(): string {
  return `${istDay().slice(0, 8)}01`;
}

function sumBy<T>(rows: T[], f: (r: T) => number): number {
  return rows.reduce((a, r) => a + (f(r) || 0), 0);
}

function TokensTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as Record<string, number>;
  return (
    <div className="tooltip">
      <div className="muted">{label}</div>
      <div>
        <span className="v">{Number(d.total).toLocaleString("en-IN")}</span> tokens
      </div>
      {PARTS.map((p) => (
        <div key={p.key}>
          <span className="v">{Number(d[p.key]).toLocaleString("en-IN")}</span> <span className="muted">{p.label.toLowerCase()}</span>
        </div>
      ))}
    </div>
  );
}

export default function Consumption() {
  useTitle("Consumption");
  const [rangeDays, setRangeDays] = useState(29);
  const [usage, setUsage] = useState<UsageDay[]>([]);
  const [apiUsage, setApiUsage] = useState<ApiUsageDay[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [credits, setCredits] = useState<CreditBalance[]>([]);
  const [topups, setTopups] = useState<Topup[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [asTable, setAsTable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const since = rangeDays === -1 ? monthStartIst() : daysAgoIst(rangeDays);
  // always fetch at least the month so "money used this month" is right whatever range is selected
  const fetchSince = since < monthStartIst() ? since : monthStartIst();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, a, b, c, t, r] = await Promise.all([
        api.usageDaily(fetchSince),
        api.apiUsageDaily(fetchSince),
        api.latestBalances(),
        api.creditBalances(),
        api.topups(),
        api.runs(14),
      ]);
      setUsage(u);
      setApiUsage(a);
      setBalances(b);
      setCredits(c);
      setTopups(t);
      setRuns(r);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fetchSince]);

  useEffect(() => {
    load();
  }, [load]);

  const today = istDay();
  const month = monthStartIst();
  const inRange = usage.filter((r) => r.day >= since);
  const todayRows = usage.filter((r) => r.day === today);
  const monthRows = usage.filter((r) => r.day >= month);
  const tokens = (rows: UsageDay[]) => sumBy(rows, (r) => r.input_tokens + r.output_tokens + r.thinking_tokens);
  const llmMoneyMonth = sumBy(monthRows, (r) => Number(r.cost_usd));
  const apiMoneyMonth = sumBy(
    apiUsage.filter((r) => r.day >= month),
    (r) => Number(r.cost_usd),
  );
  const shadowRange = sumBy(inRange, (r) => Number(r.shadow_cost_usd));

  const rows: Row[] = useMemo(() => {
    const out: Row[] = balances
      .filter((b) => !credits.some((c) => `${c.provider}:credit` === b.provider))
      .map((b) => ({
        provider: b.provider,
        used: Number(b.used),
        limit: b.limit_value == null ? null : Number(b.limit_value),
        remaining: b.remaining == null ? null : Number(b.remaining),
        unit: b.unit,
        period: b.period,
        source:
          b.method === "live_api" ? "Live from provider" : b.method === "manual" ? "Top-ups − spend" : "Bot ledger",
        checked: b.checked_at,
        note: b.note,
      }));
    for (const c of credits) {
      out.push({
        provider: `${c.provider}:credit`,
        used: Number(c.spent_usd),
        limit: Number(c.credit_usd),
        remaining: Number(c.balance_usd),
        unit: "USD",
        period: "since first top-up",
        source: "Top-ups − spend (live)",
        checked: null,
        note: "Anthropic has no balance API; add each purchase below",
      });
    }
    return out.sort(
      (a, b) => (a.unit === "USD" ? 0 : 1) - (b.unit === "USD" ? 0 : 1) || a.provider.localeCompare(b.provider),
    );
  }, [balances, credits]);

  const moneyBalance = sumBy(
    rows.filter((r) => r.unit === "USD" && (r.provider === "apify" || r.provider.endsWith(":credit"))),
    (r) => r.remaining ?? 0,
  );
  const quotaToday = rows.filter((r) => r.provider.startsWith("gemini:") && r.period === "day");

  const daily = useMemo(() => {
    const byDay = new Map<
      string,
      { day: string; input_tokens: number; output_tokens: number; thinking_tokens: number }
    >();
    const start = new Date(`${since}T00:00:00`);
    for (let d = new Date(start); istDay(d) <= today; d.setDate(d.getDate() + 1)) {
      byDay.set(istDay(d), { day: istDay(d), input_tokens: 0, output_tokens: 0, thinking_tokens: 0 });
    }
    for (const r of inRange) {
      const e = byDay.get(r.day) ?? { day: r.day, input_tokens: 0, output_tokens: 0, thinking_tokens: 0 };
      e.input_tokens += r.input_tokens;
      e.output_tokens += r.output_tokens;
      e.thinking_tokens += r.thinking_tokens;
      byDay.set(r.day, e);
    }
    return [...byDay.values()]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({ ...d, total: d.input_tokens + d.output_tokens + d.thinking_tokens }));
  }, [inRange, since, today]);

  const group = (key: "purpose" | "model") => {
    const m = new Map<
      string,
      {
        name: string;
        requests: number;
        failed: number;
        inp: number;
        out: number;
        think: number;
        cost: number;
        shadow: number;
      }
    >();
    for (const r of inRange) {
      const k = r[key];
      const e = m.get(k) ?? { name: k, requests: 0, failed: 0, inp: 0, out: 0, think: 0, cost: 0, shadow: 0 };
      e.requests += r.requests;
      e.failed += r.failed;
      e.inp += r.input_tokens;
      e.out += r.output_tokens;
      e.think += r.thinking_tokens;
      e.cost += Number(r.cost_usd);
      e.shadow += Number(r.shadow_cost_usd);
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.inp + b.out - (a.inp + a.out));
  };

  const sourceTotals = useMemo(() => {
    const m = new Map<string, { source: string; calls: number; results: number; cost: number; failures: number }>();
    for (const r of apiUsage.filter((x) => x.day >= since)) {
      const e = m.get(r.source) ?? { source: r.source, calls: 0, results: 0, cost: 0, failures: 0 };
      e.calls += r.calls;
      e.results += r.results;
      e.cost += Number(r.cost_usd);
      e.failures += r.failures;
      m.set(r.source, e);
    }
    return [...m.values()].sort((a, b) => b.results - a.results);
  }, [apiUsage, since]);

  const healthRuns = [...runs].reverse();
  const healthSources = [...new Set(healthRuns.flatMap((r) => (r.summary?.sources ?? []).map((s) => s.source)))];

  return (
    <div aria-busy={loading}>
      <div className="page-head">
        <div>
          <h1>Consumption</h1>
          <p className="lede">Tokens, money spent and what is left on every service the bot uses.</p>
        </div>
        <div className="seg" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.label} onClick={() => setRangeDays(r.days)} aria-pressed={rangeDays === r.days}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}

      <dl className="ledger" aria-label="Summary">
        <Cell term={"Tokens today"} value={compact(tokens(todayRows))} sub={`${compact(sumBy(todayRows, (r) => r.input_tokens))} in · ${compact(sumBy(todayRows, (r) => r.output_tokens))} out · ${compact(sumBy(todayRows, (r) => r.thinking_tokens))} thinking`}
        />
        <Cell term={`Tokens, ${RANGES.find((r) => r.days === rangeDays)?.label.toLowerCase()}`} value={compact(tokens(inRange))} sub={`${sumBy(inRange, (r) => r.requests).toLocaleString("en-IN")} LLM requests`}
        />
        <Cell term={"Money used this month"} value={usd(llmMoneyMonth + apiMoneyMonth)} sub={`${inr(llmMoneyMonth + apiMoneyMonth)} · LLM ${usd(llmMoneyMonth)} · scrapers ${usd(apiMoneyMonth)}`}
        />
        <Cell term={"Current balance"} value={usd(moneyBalance)} sub={`${inr(moneyBalance)} across ${rows.filter((r) => r.unit === "USD" && (r.provider === "apify" || r.provider.endsWith(":credit"))).length} paid services`}
        />
        <Cell term={"Free LLM requests left today"} value={quotaToday.map((q) => amount(q.remaining, q.unit)).join(" / ") || "-"} sub={
            quotaToday.map((q) => providerLabel(q.provider).replace("Gemini · ", "")).join(" / ") +
            " · resets 12:30 IST"
          }
        />
        <Cell term={"Would cost on a paid model"} value={usd(shadowRange)} sub="same usage priced at the shadow model in pricing.yaml"
        />
      </dl>

      <section className="section" aria-labelledby="bal-h">
        <h2 id="bal-h">Balances</h2>
        <div className="panel">
        <div className="table-wrap">
          <table className="entries">
            <thead>
              <tr>
                <th>Service</th>
                <th className="right">Used</th>
                <th className="right">Limit</th>
                <th className="right">Current balance</th>
                <th style={{ width: 160 }}>Usage</th>
                <th>Period</th>
                <th className="hide-sm">From</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.provider}>
                  <td className="cell-role">
                    <div style={{ fontWeight: 600 }}>{providerLabel(r.provider)}</div>
                    {r.note && <div className="muted small">{r.note}</div>}
                    <div className="only-narrow soft small num">
                      {amount(r.used, r.unit)} of {amount(r.limit, r.unit)} used · per {r.period}
                    </div>
                  </td>
                  <td className="right num only-wide">{amount(r.used, r.unit)}</td>
                  <td className="right num only-wide">{amount(r.limit, r.unit)}</td>
                  <td className="right num cell-scores">
                    <strong>{amount(r.remaining, r.unit)}</strong>
                    {r.unit === "USD" && <div className="muted small">{inr(r.remaining)}</div>}
                    {r.limit != null && r.remaining != null && r.remaining / r.limit < 0.2 && (
                      <div>
                        <LowFlag />
                      </div>
                    )}
                  </td>
                  <td className="cell-status">
                    <Meter used={r.used} limit={r.limit} label={providerLabel(r.provider)} />
                  </td>
                  <td className="only-wide">{r.period}</td>
                  <td className="hide-sm only-wide muted">
                    {r.source}
                    {r.checked && <div>{ago(r.checked)}</div>}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="muted">
                    No balance snapshots yet. They are recorded at the end of every run.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
      </section>

      <section className="section" aria-labelledby="tok-h">
        <div className="section-head">
          <h2 id="tok-h">Tokens per day</h2>
          <button className="btn small" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? "Show chart" : "View as table"}
          </button>
        </div>
        <div className="panel panel-pad">
        <p className="muted small" style={{ marginBottom: 8 }}>
          Input, output and thinking tokens together, per day (IST). Hover a bar for the split, or view as a table.
        </p>
        {asTable ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Day (IST)</th>
                  {PARTS.map((s) => (
                    <th key={s.key} className="right">
                      {s.label}
                    </th>
                  ))}
                  <th className="right">Total</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    {PARTS.map((s) => (
                      <td key={s.key} className="right num">
                        {d[s.key].toLocaleString("en-IN")}
                      </td>
                    ))}
                    <td className="right num">
                      {(d.input_tokens + d.output_tokens + d.thinking_tokens).toLocaleString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis
                  dataKey="day"
                  tickFormatter={(d: string) => d.slice(5)}
                  tick={{ fill: "var(--ink-3)", fontSize: 12 }}
                  axisLine={{ stroke: "var(--rule-strong)" }}
                  tickLine={false}
                  minTickGap={16}
                />
                <YAxis
                  tickFormatter={(v: number) => compact(v)}
                  tick={{ fill: "var(--ink-3)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip content={<TokensTooltip />} cursor={{ fill: "var(--surface-2)" }} />
                <Bar
                  dataKey="total"
                  name="Tokens"
                  fill="var(--series-1)"
                  maxBarSize={24}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        </div>
      </section>

      <div className="cols-2 section">
        {(["purpose", "model"] as const).map((key) => (
          <section key={key} aria-label={key === "purpose" ? "By purpose" : "By model"}>
            <h2 style={{ marginBottom: 10 }}>{key === "purpose" ? "By purpose" : "By model"}</h2>
            <div className="panel table-wrap">
            <table className="entries">
              <thead>
                <tr>
                  <th>{key === "purpose" ? "Purpose" : "Model"}</th>
                  <th className="right">Requests</th>
                  <th className="right">Tokens in / out</th>
                  <th className="right">Avg / request</th>
                  <th className="right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {group(key).map((g) => (
                  <tr key={g.name}>
                    <td className="cell-role">
                      {g.name}
                      {g.failed > 0 && <div className="warn small">{g.failed} failed or rate-limited</div>}
                      <div className="only-narrow soft small num">
                        {g.requests.toLocaleString("en-IN")} requests · {compact(g.inp)} in / {compact(g.out + g.think)} out
                      </div>
                    </td>
                    <td className="right num only-wide">{g.requests.toLocaleString("en-IN")}</td>
                    <td className="right num only-wide">
                      {compact(g.inp)} / {compact(g.out + g.think)}
                    </td>
                    <td className="right num only-wide">{g.requests ? compact((g.inp + g.out + g.think) / g.requests) : "-"}</td>
                    <td className="right num cell-scores">
                      {usd(g.cost)}
                      <div className="muted small">paid ≈ {usd(g.shadow)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </section>
        ))}
      </div>

      <div className="cols-2 section">
        <section aria-labelledby="health-h">
          <h2 id="health-h" style={{ marginBottom: 10 }}>Job sources, last {healthRuns.length} runs</h2>
          <div className="panel panel-pad table-wrap">
          <div className="legend">
            {Object.entries(HEALTH)
              .filter(([k]) => k !== "error")
              .map(([k, h]) => (
                <span key={k} className="row" style={{ gap: 6 }}>
                  <span className={`cell ${h.cls}`} style={{ width: 18, height: 18 }} aria-hidden>
                    {h.icon}
                  </span>
                  {h.label}
                </span>
              ))}
          </div>
          <table className="health">
            <tbody>
              {healthSources.map((src) => (
                <tr key={src}>
                  <th>{sourceLabel(src)}</th>
                  {healthRuns.map((run) => {
                    const s = run.summary?.sources?.find((x) => x.source === src);
                    const h = HEALTH[s?.status ?? "skipped"] ?? HEALTH.error;
                    const label = `${sourceLabel(src)}, ${new Date(run.started_at).toLocaleString("en-IN")}: ${h.label}${s ? `, ${s.results} jobs` : ""}${s?.error ? ` (${s.error})` : ""}`;
                    return (
                      <td key={run.id}>
                        <div className={`cell ${h.cls}`} title={label} aria-label={label} tabIndex={0}>
                          {h.icon}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 8 }}>
            Oldest run on the left. Hover or focus a cell for details.
          </p>
          </div>
        </section>
        <section aria-labelledby="src-h">
          <h2 id="src-h" style={{ marginBottom: 10 }}>Job source usage</h2>
          <div className="panel table-wrap">
          <table className="entries">
            <thead>
              <tr>
                <th>Source</th>
                <th className="right">Calls</th>
                <th className="right">Jobs returned</th>
                <th className="right">Failed runs</th>
                <th className="right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {sourceTotals.map((s) => (
                <tr key={s.source}>
                  <td className="cell-role">
                    {sourceLabel(s.source)}
                    <div className="only-narrow soft small num">
                      {s.calls.toLocaleString("en-IN")} calls · {s.failures} failed runs · {usd(s.cost)}
                    </div>
                  </td>
                  <td className="right num only-wide">{s.calls.toLocaleString("en-IN")}</td>
                  <td className="right num cell-scores">
                    {s.results.toLocaleString("en-IN")}
                    <span className="only-narrow muted small"> jobs</span>
                  </td>
                  <td className="right num only-wide">{s.failures}</td>
                  <td className="right num only-wide">{usd(s.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      </div>

      <TopUps topups={topups} onChange={load} />
    </div>
  );
}

function TopUps({ topups, onChange }: { topups: Topup[]; onChange: () => void }) {
  const [provider, setProvider] = useState("anthropic");
  const [amountUsd, setAmountUsd] = useState("");
  const [date, setDate] = useState(istDay());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="section" aria-labelledby="top-h">
      <h2 id="top-h" style={{ marginBottom: 6 }}>Credit top-ups</h2>
      <p className="soft" style={{ marginBottom: 10 }}>
        Claude (and paid Gemini) have no API that reports your remaining credit. Record each purchase here and the
        balance above becomes top-ups minus what the bot has spent since.
      </p>
      <form
        className="filters"
        onSubmit={async (e) => {
          e.preventDefault();
          const value = Number(amountUsd);
          if (!(value > 0)) {
            setError("Enter an amount above 0");
            return;
          }
          try {
            await api.addTopup({
              provider,
              amount_usd: value,
              purchased_at: new Date(`${date}T12:00:00+05:30`).toISOString(),
              note: note || null,
            });
            setAmountUsd("");
            setNote("");
            setError(null);
            onChange();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Provider">
          <option value="anthropic">Claude (Anthropic)</option>
          <option value="gemini">Gemini (paid tier)</option>
        </select>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="Amount in USD"
          value={amountUsd}
          onChange={(e) => setAmountUsd(e.target.value)}
          aria-label="Amount in USD"
        />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Purchase date" />
        <input type="text" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn primary">Add top-up</button>
        {error && <span className="error-text">{error}</span>}
      </form>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Service</th>
              <th className="right">Amount</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {topups.map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.purchased_at).toLocaleDateString("en-IN")}</td>
                <td>{providerLabel(t.provider)}</td>
                <td className="right num">
                  {usd(Number(t.amount_usd))} <span className="muted">{inr(Number(t.amount_usd))}</span>
                </td>
                <td className="muted">{t.note}</td>
                <td className="right">
                  <button className="btn quiet small" onClick={() => api.deleteTopup(t.id).then(onChange)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {!topups.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No top-ups recorded. You are on free tiers only.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Cell({ term, value, sub }: { term: string; value: string; sub?: string }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>
        {value}
        {sub && <span className="small">{sub}</span>}
      </dd>
    </div>
  );
}
