// The LaTeX editor on a job's page: load a resume's .tex, save an edit (resume_edits, migration 0009), start its
// compile through the tailor-now function, and follow it until the new PDF lands or the LaTeX error comes back.
import { api, supabase } from "./api";

export type EditStatus = "queued" | "compiling" | "done" | "failed";

export interface EditState {
  status: EditStatus;
  error: string | null;
  result_tailoring_id: string | null;
}

export interface LatexEditApi {
  loadTex(path: string): Promise<string>;
  /** Save the edited source; returns the edit's id. */
  saveEdit(jobId: string, baseTailoringId: string | null, tex: string): Promise<string>;
  /** Start compiling now. Resolves to a message; rejects with GitHub's reason (the edit stays queued for the scan). */
  compile(editId: string): Promise<string>;
  state(editId: string): Promise<EditState>;
}

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const DEMO_TEX = String.raw`\documentclass[10pt]{article}
\usepackage[hidelinks]{hyperref}
\begin{document}
\begin{center}
{\LARGE\bfseries Demo Candidate}\par
Backend Software Engineer\par
Gurugram, India, demo@example.com, +91 90000 00000\par
linkedin.com/in/demo-candidate, github.com/demo-candidate\par
\end{center}
\section*{Experience}
\begin{itemize}
  \item Built REST APIs on Azure Functions that onboard franchise partners end to end.
\end{itemize}
\end{document}
`;

const demoEdits = new Map<string, EditState>();

const demoLatex: LatexEditApi = {
  async loadTex() {
    return DEMO_TEX;
  },
  async saveEdit() {
    const id = `edit-${Date.now()}`;
    demoEdits.set(id, { status: "queued", error: null, result_tailoring_id: null });
    return id;
  },
  async compile(editId) {
    setTimeout(() => demoEdits.set(editId, { status: "done", error: null, result_tailoring_id: null }), 2500);
    return "Compiling your edit (demo: nothing is saved).";
  },
  async state(editId) {
    return demoEdits.get(editId) ?? { status: "failed", error: "Unknown edit", result_tailoring_id: null };
  },
};

function supabaseLatex(client: NonNullable<typeof supabase>): LatexEditApi {
  return {
    async loadTex(path) {
      const res = await fetch(await api.signedUrl(path));
      if (!res.ok) throw new Error(`Could not load the LaTeX source (${res.status})`);
      return res.text();
    },
    async saveEdit(jobId, baseTailoringId, tex) {
      const row = must(
        await client.from("resume_edits").insert({ job_id: jobId, base_tailoring_id: baseTailoringId, tex }).select("id").single(),
      ) as { id: string };
      return row.id;
    },
    async compile(editId) {
      const { data, error } = await client.functions.invoke("tailor-now", { body: { edit_id: editId } });
      if (error) {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(body?.error ?? error.message);
      }
      return (data as { message?: string })?.message ?? "Compiling your edit.";
    },
    async state(editId) {
      return must(
        await client.from("resume_edits").select("status,error,result_tailoring_id").eq("id", editId).single(),
      ) as EditState;
    },
  };
}

export const latexApi: LatexEditApi = supabase ? supabaseLatex(supabase) : demoLatex;

// linkedin.com/in/<handle> or github.com/<handle>, where a handle may hold \_ but never a trailing "." or ","
const PATH = String.raw`(?:linkedin\.com\/in|github\.com)\/(?:[A-Za-z0-9_\-.%]|\\_)*[A-Za-z0-9_\-]`;
const inText = () => new RegExp(String.raw`(?:https?:\/\/)?(?:www\.)?(${PATH})`, "g");
const HREF = /(\\href\{[^}]*\}\{(?:[^{}]|\{[^{}]*\})*\})/;
const siteName = (path: string) => (path.startsWith("github") ? "GitHub" : "LinkedIn");

/** Quick fix: show LinkedIn and GitHub addresses as their names, with the address behind them (\href). An existing
 * link whose visible text is the address gets the name as its text; comment lines are left alone. Returns the new
 * source and how many were changed. */
export function linkProfiles(tex: string): { tex: string; changed: number } {
  let changed = 0;
  const convertText = (text: string) =>
    text
      .replace(/\\url\{([^}]*)\}/g, (whole, inner: string) => (inText().test(inner) ? inner : whole))
      .replace(inText(), (_m, path: string) => {
        changed += 1;
        return String.raw`\href{https://${path.replace(/\\_/g, "_")}}{${siteName(path)}}`;
      });
  const convertLink = (link: string) => {
    const m = link.match(/^\\href\{([^}]*)\}\{([\s\S]*)\}$/);
    if (!m) return link;
    const label = m[2].replace(inText(), (_m, path: string) => siteName(path));
    if (label === m[2]) return link;
    changed += 1;
    return String.raw`\href{${m[1]}}{${label}}`;
  };
  const out = tex
    .split("\n")
    .map((line) => (/^\s*%/.test(line) ? line : line.split(HREF).map((part, i) => (i % 2 ? convertLink(part) : convertText(part))).join("")))
    .join("\n");
  return { tex: out, changed };
}
