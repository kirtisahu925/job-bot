import { X } from "lucide-react";
import { useId, useState } from "react";
import { ICON } from "./bits";

/** A list of short values: type and press Enter (or a comma) to add, the x to remove. */
export function ChipInput({
  label,
  value,
  onChange,
  placeholder,
  suggestions = [],
  hint,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  hint?: string;
}) {
  const [draft, setDraft] = useState("");
  const id = useId();
  const add = (raw: string) => {
    const v = raw.trim().replace(/,$/, "").trim();
    if (v && !value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, v]);
    setDraft("");
  };
  const left = suggestions.filter((s) => !value.some((x) => x.toLowerCase() === s.toLowerCase()));
  return (
    <div className="field chip-input">
      <label htmlFor={id}>{label}</label>
      {!!value.length && (
        <div className="chips" aria-label={`${label}: ${value.length}`}>
          {value.map((v) => (
            <span className="chip" key={v}>
              {v}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
                <X {...ICON} size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        id={id}
        value={draft}
        placeholder={placeholder}
        list={left.length ? `${id}-list` : undefined}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
      {!!left.length && (
        <datalist id={`${id}-list`}>
          {left.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
