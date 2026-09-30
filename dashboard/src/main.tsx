import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import App from "./App";
import "./index.css";
import { loadSavedTheme } from "./lib/theme";

loadSavedTheme();

/** A render error shows what broke, instead of unmounting the whole sheet to a blank page. */
class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <p className="boot failed" role="alert">
        Fairsheet hit an error: {this.state.error.message}. Reload the page; if this stays, send this message and the red
        lines from the browser console (F12).
      </p>
    );
  }
}

const root = document.getElementById("root")!;
root.dataset.started = "1";
createRoot(root).render(
  <StrictMode>
    <Crash>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Crash>
  </StrictMode>,
);
