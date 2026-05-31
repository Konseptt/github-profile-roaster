"use client";

import { FormEvent, useRef, useState } from "react";
import { STREAM_ERROR_PREFIX } from "@/lib/constants";

type LoadPhase = "idle" | "github" | "roast";

const CLIENT_TIMEOUT_MS = 120_000;

export default function Home() {
  const [username, setUsername] = useState("");
  const [output, setOutput] = useState("");
  const [phase, setPhase] = useState<LoadPhase>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const loading = phase !== "idle";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const name = username.trim();
    if (!name) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const timeout = window.setTimeout(() => ac.abort(), CLIENT_TIMEOUT_MS);

    setOutput("");
    setErrorMsg("");
    setPhase("github");

    try {
      const res = await fetch("/api/roast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      setPhase("roast");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        if (buffer.startsWith(STREAM_ERROR_PREFIX)) {
          const message = buffer.slice(STREAM_ERROR_PREFIX.length).trim();
          throw new Error(message || "Request failed");
        }

        setOutput(buffer);
        setPhase("idle");
      }

      if (buffer.startsWith(STREAM_ERROR_PREFIX)) {
        throw new Error(buffer.slice(STREAM_ERROR_PREFIX.length).trim());
      }

      setPhase("idle");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setErrorMsg("Timed out or cancelled. Try again.");
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Something broke");
      }
      setPhase("idle");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function onStop() {
    abortRef.current?.abort();
    setPhase("idle");
  }

  return (
    <main className="site">
      <header>
        <p className="blink">*** welcome ***</p>
        <h1>GitHub Profile Roaster</h1>
        <p className="tagline">
          enter a username. we read your public repos, commits, languages, and
          readmes, then tell you what hurts.
        </p>
        <hr />
      </header>

      <form onSubmit={onSubmit} className="form-row">
        <label htmlFor="gh-user">
          github.com/
          <input
            id="gh-user"
            name="username"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="octocat"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
          />
        </label>
        <button type="submit" disabled={loading || !username.trim()}>
          {loading ? "roasting..." : "roast me"}
        </button>
        {loading && (
          <button type="button" className="stop" onClick={onStop}>
            stop
          </button>
        )}
      </form>

      {errorMsg && (
        <p className="err" role="alert">
          {errorMsg}
        </p>
      )}

      {phase === "github" && (
        <p className="wait">fetching github data...</p>
      )}

      {phase === "roast" && !output && (
        <p className="wait">github done. writing roast (can take a minute)...</p>
      )}

      {output && (
        <section className="result" aria-live="polite">
          <h2>report for @{username.trim()}</h2>
          <pre>{output}</pre>
        </section>
      )}

      <footer>
        <hr />
        <p>
          built for fun. only public api data. keys stay on the server. not
          affiliated with GitHub or NVIDIA.
        </p>
      </footer>
    </main>
  );
}
