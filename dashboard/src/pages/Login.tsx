import { useState } from "react";
import { Mark } from "../components/bits";
import { api } from "../lib/api";

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="login">
      <div className="login-card">
        <div className="head">
          <Mark size={36} />
          <div>
            <h1>Sign in to Fairsheet</h1>
            <p className="muted small" style={{ marginTop: 6 }}>
              Your job tracker. Use the login you created in Supabase.
            </p>
          </div>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api.signIn(email, password);
              onSignedIn();
            } catch (err) {
              setError(`${(err as Error).message}. Check the email and password, then try again.`);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button className="btn primary" disabled={busy} aria-busy={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
