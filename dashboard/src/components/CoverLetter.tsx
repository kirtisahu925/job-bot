import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { ICON } from "./bits";

/** The cover letter saved with a tailored resume, ready to copy into an application. */
export default function CoverLetter({ text }: { text: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2000);
  };
  return (
    <section className="panel panel-pad" aria-labelledby="letter-h">
      <div className="section-head">
        <div>
          <h2 id="letter-h">Cover letter</h2>
          <p className="muted xs" style={{ marginTop: 4 }}>
            Written from this resume. A sentence citing anything your resume or profile does not say is removed.
          </p>
        </div>
        <button type="button" className="btn small" onClick={copy} aria-live="polite">
          {copied === "done" ? <Check {...ICON} size={14} /> : <Copy {...ICON} size={14} />}
          {copied === "done" ? "Copied" : copied === "failed" ? "Select and copy" : "Copy"}
        </button>
      </div>
      <div className="letter">{text}</div>
    </section>
  );
}
