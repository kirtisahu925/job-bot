export const FX_USD_INR = Number(import.meta.env.VITE_FX_USD_INR ?? 88);

export function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)}K`;
  if (Math.abs(n) >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

export function usd(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n === 0) return "$0";
  if (Math.abs(n) < 1) return `$${n.toFixed(n < 0.01 ? 4 : 2)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function inr(n: number | null | undefined): string {
  if (n == null) return "";
  return `₹${Math.round(n * FX_USD_INR).toLocaleString("en-IN")}`;
}

export function amount(n: number | null | undefined, unit: string): string {
  if (n == null) return "-";
  return unit === "USD" ? usd(n) : Math.round(n).toLocaleString("en-IN");
}

export function ago(isoDate: string | null | undefined): string {
  if (!isoDate) return "-";
  const mins = Math.round((Date.now() - new Date(isoDate).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function istDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

export function daysAgoIst(n: number): string {
  return istDay(new Date(Date.now() - n * 86400000));
}

export function providerLabel(p: string): string {
  const [base, model] = p.split(":");
  const names: Record<string, string> = {
    gemini: "Gemini", anthropic: "Claude", apify: "Apify (Wellfound)", jsearch: "JSearch (RapidAPI)",
    adzuna: "Adzuna", jooble: "Jooble",
  };
  const name = names[base] ?? base;
  if (model === "credit") return `${name} credit`;
  return model ? `${name} · ${model.replace(/^gemini-/, "")}` : name;
}

const SOURCE_NAMES: Record<string, string> = {
  linkedin: "LinkedIn", indeed: "Indeed", naukri: "Naukri", foundit: "Foundit", wellfound: "Wellfound",
  adzuna: "Adzuna", jsearch: "JSearch", jooble: "Jooble", remotive: "Remotive", greenhouse: "Greenhouse",
  lever: "Lever", ashby: "Ashby", extension: "Saved from browser", manual: "Added by hand",
};

export function sourceLabel(s: string): string {
  return SOURCE_NAMES[s] ?? s;
}

/** Next scheduled scan: 10:00 or 22:00 IST (04:30 / 16:30 UTC). */
export function nextScan(now: Date = new Date()): Date {
  const candidates = [-1, 0, 1].flatMap((d) =>
    [4, 16].map((h) => {
      const x = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, h, 30));
      return x;
    }),
  );
  return candidates.filter((c) => c > now).sort((a, b) => a.getTime() - b.getTime())[0];
}

export function istTime(d: Date | string): string {
  return new Date(d).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function istDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** How long a Tailor-now run is treated as in progress before the dashboard stops waiting. */
export const TAILOR_WINDOW_MS = 15 * 60 * 1000;
