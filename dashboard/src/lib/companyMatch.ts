// Matching a company on the Companies page to the names jobs and contacts use for it:
// "SAP" matches "SAP Labs India", "JPMorgan Chase" matches "JP Morgan Chase & Co.", "Target" not "Targetprocess".

const STOP = new Set(["the", "and", "co", "inc", "llc", "ltd", "limited", "pvt", "private", "plc", "corp", "corporation"]);

export function companyTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t));
}

/** True when `listed` (the Companies page name) names the same employer as `other` (a job's or contact's). */
export function sameCompany(listed: string, other: string): boolean {
  const a = companyTokens(listed);
  const b = companyTokens(other);
  if (!a.length || !b.length) return false;
  if (a.every((t, i) => b[i] === t)) return true; // "sap" is a word-prefix of "sap labs india"
  const ja = a.join("");
  // a job at "Walmart" is one at "Walmart Global Tech"; short names ("SAP", "AMD") must match whole
  if (b.every((t, i) => a[i] === t) && b.join("").length >= 5) return true;
  const jb = b.join("");
  // "jpmorganchase" vs "jp morgan chase bank"; one-word names ("Target") already matched word by word above
  return ja === jb || (a.length > 1 && jb.startsWith(ja));
}

/** Index of `listed` companies by the other names that match them, for counting jobs or contacts per company. */
export function countBy<T>(listed: string[], items: T[], nameOf: (item: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>(listed.map((n) => [n, []]));
  for (const item of items) {
    const name = nameOf(item);
    if (!name) continue;
    const hit = listed.find((l) => sameCompany(l, name));
    if (hit) out.get(hit)!.push(item);
  }
  return out;
}

export function boardUrl(board: string | null, slug: string | null): string | null {
  if (!board || !slug) return null;
  if (board === "greenhouse") return `https://job-boards.greenhouse.io/${slug}`;
  if (board === "lever") return `https://jobs.lever.co/${slug}`;
  if (board === "ashby") return `https://jobs.ashbyhq.com/${slug}`;
  if (board === "workday") {
    const [tenant, dc, site] = slug.split("/");
    return tenant && dc && site ? `https://${tenant}.${dc}.myworkdayjobs.com/${site}` : null;
  }
  return null;
}

/** "greenhouse", "remotecom" from a pasted board link, or null. A Workday site is stored as "tenant/wdN/site",
 * as jobbot/sources/discover.py reads it. */
export function parseBoardUrl(url: string): { board: "greenhouse" | "lever" | "ashby" | "workday"; slug: string } | null {
  const wd = url.match(/([\w-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)/i);
  if (wd) return { board: "workday", slug: `${wd[1]}/${wd[2]}/${wd[3]}` };
  const m =
    url.match(/(?:job-boards|boards)\.greenhouse\.io\/([\w-]+)/i) ??
    url.match(/jobs\.lever\.co\/([\w-]+)/i) ??
    url.match(/jobs\.ashbyhq\.com\/([\w.-]+)/i);
  if (!m) return null;
  const board = /greenhouse/i.test(url) ? "greenhouse" : /lever/i.test(url) ? "lever" : "ashby";
  return { board, slug: m[1] };
}
