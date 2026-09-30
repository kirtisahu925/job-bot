import { Link2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { latexApi, linkProfiles } from "../lib/latexEdit";
import type { Tailoring } from "../lib/types";
import { ICON, Notice } from "./bits";

type Phase = "loading" | "editing" | "saving" | "compiling" | "queued" | "failed";
const POLL_MS = 8000;
const GIVE_UP_MS = 8 * 60 * 1000;

/** Edit a resume's LaTeX and compile it into a new version (no AI calls; about 2 minutes on GitHub). */
export default function LatexEditor({
  jobId,
  tailoring,
  onCompiled,
  onClose,
}: {
  jobId: string;
  tailoring: Tailoring;
  onCompiled: () => void;
  onClose: () => void;
}) {
  const [tex, setTex] = useState("");
  const [original, setOriginal] = useState("");
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<{ kind: "info" | "ok" | "error" | "pending"; text: string } | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!tailoring.tex_path) return;
    latexApi.loadTex(tailoring.tex_path).then(
      (text) => {
        setTex(text);
        setOriginal(text);
        setPhase("editing");
      },
      (e: Error) => {
        setMessage({ kind: "error", text: e.message });
        setPhase("failed");
      },
    );
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [tailoring.tex_path]);

  const follow = (editId: string, started: number) => {
    timer.current = window.setTimeout(async () => {
      try {
        const s = await latexApi.state(editId);
        if (s.status === "done") {
          setMessage({ kind: "ok", text: "Compiled. The new PDF is now this job's resume; the one before stays in its history." });
          setPhase("editing");
          setOriginal(tex);
          onCompiled();
          return;
        }
        if (s.status === "failed") {
          setLog(s.error);
          setMessage({ kind: "error", text: "Your edit did not compile. The LaTeX error is below; fix it and compile again." });
          setPhase("failed");
          return;
        }
        if (Date.now() - started > GIVE_UP_MS) {
          setMessage({ kind: "info", text: "Still waiting for GitHub. The new PDF appears on this page when it is ready." });
          setPhase("queued");
          return;
        }
        follow(editId, started);
      } catch (e) {
        setMessage({ kind: "error", text: (e as Error).message });
        setPhase("failed");
      }
    }, POLL_MS);
  };

  const compile = async () => {
    setPhase("saving");
    setLog(null);
    setMessage(null);
    let editId: string;
    try {
      editId = await latexApi.saveEdit(jobId, tailoring.id, tex);
    } catch (e) {
      setMessage({ kind: "error", text: `Not saved: ${(e as Error).message}` });
      setPhase("editing");
      return;
    }
    try {
      const text = await latexApi.compile(editId);
      setMessage({ kind: "pending", text });
      setPhase("compiling");
      follow(editId, Date.now());
    } catch (e) {
      // saved, but GitHub could not be started: the next scheduled scan compiles it
      setMessage({ kind: "info", text: (e as Error).message });
      setPhase("queued");
    }
  };

  const quickFix = () => {
    const { tex: next, changed } = linkProfiles(tex);
    setTex(next);
    setMessage(
      changed
        ? { kind: "ok", text: `Linked ${changed} address${changed === 1 ? "" : "es"} by name. Compile to see it in the PDF.` }
        : { kind: "info", text: "No visible LinkedIn or GitHub address to change." },
    );
  };

  const busy = phase === "saving" || phase === "compiling";
  const dirty = tex !== original;

  return (
    <section className="panel panel-pad stack latex-editor" aria-labelledby="latex-h">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <div>
          <h2 id="latex-h">Edit the LaTeX</h2>
          <p className="muted xs" style={{ marginTop: 4, maxWidth: "62ch" }}>
            Small fixes to this resume's source. Compiling makes a new version and re-scores it; no AI is used and nothing is
            fact-checked, so what you write is what goes out.
          </p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close the editor" title="Close">
          <X {...ICON} />
        </button>
      </div>
      {message && (
        <Notice kind={message.kind} onClose={() => setMessage(null)}>
          {message.text}
        </Notice>
      )}
      <div className="row">
        <button className="btn small" onClick={quickFix} disabled={phase === "loading" || busy}>
          <Link2 {...ICON} size={14} />
          Show LinkedIn and GitHub by name
        </button>
      </div>
      <label className="visually-hidden" htmlFor="latex-src">
        LaTeX source
      </label>
      <textarea
        id="latex-src"
        className="code"
        rows={24}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        value={phase === "loading" ? "Loading…" : tex}
        readOnly={phase === "loading" || busy}
        onChange={(e) => setTex(e.target.value)}
      />
      {log && (
        <details open className="latex-log">
          <summary className="small">LaTeX error</summary>
          <pre>{log.split("\n").slice(-30).join("\n")}</pre>
        </details>
      )}
      <div className="form-actions">
        <button className="btn primary" onClick={compile} disabled={busy || phase === "loading" || !tex.trim()} aria-busy={busy}>
          {phase === "saving" ? "Saving…" : phase === "compiling" ? "Compiling… about 2 min" : "Compile"}
        </button>
        <button className="btn quiet" onClick={() => setTex(original)} disabled={!dirty || busy}>
          Undo my changes
        </button>
        {dirty && !busy && <span className="muted xs">Not compiled yet</span>}
      </div>
    </section>
  );
}
