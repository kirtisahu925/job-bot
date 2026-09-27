import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { LowFlag, Meter, StatTile } from "../components/bits";
import { api } from "../lib/api";
import { amount, ago, compact, daysAgoIst, inr, istDay, providerLabel, sourceLabel, usd } from "../lib/format";
import type { ApiUsageDay, Balance, CreditBalance, Run, Topup, UsageDay } from "../lib/types";

const RANGES = [
  { label: "Today", days: 0 },
  { label: "Last 7 days", days: 6 },
  { label: "Last 30 days", days: 29 },
  { label: "Month to date", days: -1 },
];

const SERIES = [
  { key: "input_tokens", label: "Input", color: "var(--series-1)" },
  { key: "output_tokens", label: "Output", color: "var(--series-2)" },
  { key: "thinking_tokens", label: "Thinking", color: "var(--series-3)" },
] as const;

const HEALTH: Record<string, { color: string; symbol: string; label: string }> = {
  ok: { color: "var(--good)", symbol: "✓", label: "OK" },
  empty: { color: "var(--warning)", symbol: "0", label: "No results" },
  blocked: { color: "var(--serious)", symbol: "!", label: "Blocked / rate-limited" },
  broken: { color: "var(--critical)", symbol: "×", label: "Broken (site changed)" },
  error: { color: "var(--critical)", symbol: "×", label: "Error" },
  timeout: { color: "var(--critical)", symbol: "⏱", label: "Timed out" },
  skipped: { color: "var(--axis)", symbol: "–", label: "Skipped (no key)" },
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
  const total = sumBy(payload, (p) => Number(p.value));
  return (
    <div className="tooltip">
      <div className="muted">{label}</div>
      <div>
        <span className="v">{total.toLocaleString("en-IN")}</span> tokens
      </div>
      {[...payload].reverse().map((p) => (
        <div key={String(p.dataKey)}>
          <span className="linekey" style={{ background: p.color }} />
          <span className="v">{Number(p.value).toLocaleString("en-IN")}</span> <span className="muted">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

export default function Consumption() {
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
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
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
    <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity .2s" }}>
      <div className="page-head">
        <div>
          <h1>Consumption</h1>
          <div className="muted">Tokens, money used and what is left on every service the bot uses.</div>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="filters">
        {RANGES.map((r) => (
          <button
            key={r.label}
            className={`btn small${rangeDays === r.days ? " primary" : ""}`}
            onClick={() => setRangeDays(r.days)}
            aria-pressed={rangeDays === r.days}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="tiles">
        <StatTile
          label="Tokens today"
          value={compact(tokens(todayRows))}
          sub={`${compact(sumBy(todayRows, (r) => r.input_tokens))} in · ${compact(sumBy(todayRows, (r) => r.output_tokens))} out · ${compact(sumBy(todayRows, (r) => r.thinking_tokens))} thinking`}
        />
        <StatTile
          label={`Tokens, ${RANGES.find((r) => r.days === rangeDays)?.label.toLowerCase()}`}
          value={compact(tokens(inRange))}
          sub={`${sumBy(inRange, (r) => r.requests).toLocaleString("en-IN")} LLM requests`}
        />
        <StatTile
          label="Money used this month"
          value={usd(llmMoneyMonth + apiMoneyMonth)}
          sub={`${inr(llmMoneyMonth + apiMoneyMonth)} · LLM ${usd(llmMoneyMonth)} · scrapers ${usd(apiMoneyMonth)}`}
        />
        <StatTile
          label="Current balance"
          value={usd(moneyBalance)}
          sub={`${inr(moneyBalance)} across ${rows.filter((r) => r.unit === "USD" && (r.provider === "apify" || r.provider.endsWith(":credit"))).length} paid services`}
        />
        <StatTile
          label="Free LLM requests left today"
          value={quotaToday.map((q) => amount(q.remaining, q.unit)).join(" / ") || "-"}
          sub={
            quotaToday.map((q) => providerLabel(q.provider).replace("Gemini · ", "")).join(" / ") +
            " · resets 12:30 IST"
          }
        />
        <StatTile
          label="Would cost on a paid model"
          value={usd(shadowRange)}
          sub="same usage priced at the shadow model in pricing.yaml"
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Balances</h2>
        <div className="table-wrap">
          <table>
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
                  <td>
                    <div style={{ fontWeight: 600 }}>{providerLabel(r.provider)}</div>
                    {r.note && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {r.note}
                      </div>
                    )}
                  </td>
                  <td className="right num">{amount(r.used, r.unit)}</td>
                  <td className="right num">{amount(r.limit, r.unit)}</td>
                  <td className="right num">
                    <strong>{amount(r.remaining, r.unit)}</strong>
                    {r.unit === "USD" && <div className="muted">{inr(r.remaining)}</div>}
                    {r.limit != null && r.remaining != null && r.remaining / r.limit < 0.2 && <LowFlag />}
                  </td>
                  <td>
                    <Meter used={r.used} limit={r.limit} />
                  </td>
                  <td>{r.period}</td>
                  <td className="hide-sm muted">
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

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Token consumption per day</h2>
          <button className="btn small" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? "Show chart" : "View as table"}
          </button>
        </div>
        <div className="legend">
          {SERIES.map((s) => (
            <span key={s.key}>
              <span className="key" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        {asTable ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Day (IST)</th>
                  {SERIES.map((s) => (
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
                    {SERIES.map((s) => (
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
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis
                  dataKey="day"
                  tickFormatter={(d: string) => d.slice(5)}
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  axisLine={{ stroke: "var(--axis)" }}
                  tickLine={false}
                  minTickGap={16}
                />
                <YAxis
                  tickFormatter={(v: number) => compact(v)}
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip content={<TokensTooltip />} cursor={{ fill: "var(--surface-2)" }} />
                {SERIES.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    stackId="t"
                    fill={s.color}
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                    maxBarSize={24}
                    radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        {(["purpose", "model"] as const).map((key) => (
          <div className="card table-wrap" key={key}>
            <h2>{key === "purpose" ? "By purpose" : "By model"}</h2>
            <table>
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
                    <td>
                      {g.name}
                      {g.failed > 0 && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {g.failed} failed / rate-limited
                        </div>
                      )}
                    </td>
                    <td className="right num">{g.requests.toLocaleString("en-IN")}</td>
                    <td className="right num">
                      {compact(g.inp)} / {compact(g.out + g.think)}
                    </td>
                    <td className="right num">{g.requests ? compact((g.inp + g.out + g.think) / g.requests) : "-"}</td>
                    <td className="right num">
                      {usd(g.cost)}
                      <div className="muted">paid ≈ {usd(g.shadow)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <div className="card table-wrap">
          <h2>Job sources, last {healthRuns.length} runs</h2>
          <div className="legend">
            {Object.entries(HEALTH)
              .filter(([k]) => k !== "error")
              .map(([k, h]) => (
                <span key={k}>
                  <span className="key" style={{ background: h.color }} />
                  {h.symbol} {h.label}
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
                        <div
                          className="cell"
                          style={{ background: h.color }}
                          title={label}
                          aria-label={label}
                          tabIndex={0}
                        >
                          {h.symbol}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Oldest run on the left. Hover a cell for details.
          </div>
        </div>
        <div className="card table-wrap">
          <h2>Job source usage</h2>
          <table>
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
                  <td>{sourceLabel(s.source)}</td>
                  <td className="right num">{s.calls.toLocaleString("en-IN")}</td>
                  <td className="right num">{s.results.toLocaleString("en-IN")}</td>
                  <td className="right num">{s.failures}</td>
                  <td className="right num">{usd(s.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    <div className="card">
      <h2>Credit top-ups</h2>
      <p className="muted" style={{ marginTop: 0 }}>
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
        {error && <span className="error">{error}</span>}
      </form>
      <div className="table-wrap">
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
                  <button className="btn small" onClick={() => api.deleteTopup(t.id).then(onChange)}>
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
    </div>
  );
}
