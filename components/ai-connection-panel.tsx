"use client";

import type { AiConnectionSettings, AiConnectionState } from "@/lib/types";

interface AiConnectionPanelProps {
  connection: AiConnectionSettings;
  state: AiConnectionState;
  isBusy: boolean;
  onChange: (next: AiConnectionSettings) => void;
  onTestConnection: () => void;
}

const BASE_URL_SUGGESTIONS = [
  "http://localhost:11434",
  "http://localhost:1234/v1",
  "http://localhost:8080/v1"
];

const CONCURRENCY_OPTIONS = [1, 2, 3, 4];

function providerLabel(state: AiConnectionState): string {
  if (state.kind === "ollama") {
    return "Ollama";
  }
  if (state.kind === "openai-compatible") {
    return "OpenAI-compatible";
  }
  return "Unknown";
}

export function AiConnectionPanel({
  connection,
  state,
  isBusy,
  onChange,
  onTestConnection
}: AiConnectionPanelProps) {
  function update<K extends keyof AiConnectionSettings>(key: K, value: AiConnectionSettings[K]) {
    onChange({ ...connection, [key]: value });
  }

  return (
    <section className="panel">
      <h2>3) Local AI Connection</h2>
      <p className="muted">
        Point this at a model server the app server can reach: Ollama, LM Studio, llama.cpp, or anything
        OpenAI-compatible, on this machine or across Tailscale. Requests are proxied through this app, so the model
        server needs no CORS setup.
      </p>

      <div className="settings-grid">
        <label className="field field-wide">
          <span>Base URL</span>
          <input
            type="text"
            list="ai-base-url-suggestions"
            placeholder="http://localhost:11434"
            value={connection.baseUrl}
            onChange={(event) => update("baseUrl", event.target.value)}
          />
          <datalist id="ai-base-url-suggestions">
            {BASE_URL_SUGGESTIONS.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </label>

        <label className="field">
          <span>Model</span>
          {state.models.length > 0 ? (
            <select value={connection.model} onChange={(event) => update("model", event.target.value)}>
              <option value="">Select a model</option>
              {state.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              placeholder="Test the connection to list models"
              value={connection.model}
              onChange={(event) => update("model", event.target.value)}
            />
          )}
        </label>

        <label className="field">
          <span>API Key (Optional)</span>
          <input
            type="password"
            placeholder="Only if your server requires one"
            value={connection.apiKey}
            onChange={(event) => update("apiKey", event.target.value)}
          />
        </label>

        <label className="field">
          <span>Temperature</span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={connection.temperature}
            onChange={(event) => update("temperature", Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span>Max Output Tokens</span>
          <input
            type="number"
            min={256}
            max={131072}
            step={256}
            value={connection.maxOutputTokens}
            onChange={(event) => update("maxOutputTokens", Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span>Context Tokens</span>
          <input
            type="number"
            min={1024}
            max={1048576}
            step={1024}
            value={connection.contextTokens}
            onChange={(event) => update("contextTokens", Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span>Parallel Requests</span>
          <select
            value={connection.concurrency}
            onChange={(event) => update("concurrency", Number(event.target.value))}
          >
            {CONCURRENCY_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Model Reasoning</span>
          <select
            value={connection.reasoning}
            onChange={(event) => update("reasoning", event.target.value as AiConnectionSettings["reasoning"])}
          >
            <option value="off">Off (much faster)</option>
            <option value="on">On (let the model think)</option>
          </select>
        </label>

        <label className="field">
          <span>Structured Output</span>
          <select
            value={connection.structuredOutput}
            onChange={(event) =>
              update("structuredOutput", event.target.value as AiConnectionSettings["structuredOutput"])
            }
          >
            <option value="auto">Auto (fall back if unsupported)</option>
            <option value="on">Always use JSON schema</option>
            <option value="off">Off (prompt only)</option>
          </select>
        </label>

        <label className="field">
          <span>Request Timeout (Seconds)</span>
          <input
            type="number"
            min={5}
            max={900}
            step={5}
            value={Math.round(connection.requestTimeoutMs / 1000)}
            onChange={(event) => update("requestTimeoutMs", Math.round(Number(event.target.value) * 1000))}
          />
        </label>
      </div>

      <div className="actions-row">
        <button type="button" onClick={onTestConnection} disabled={isBusy || state.status === "checking"}>
          {state.status === "checking" ? "Checking..." : "Test Connection"}
        </button>
        <span className="muted">
          {state.status === "connected"
            ? `Connected to ${providerLabel(state)} with ${state.models.length} model${state.models.length === 1 ? "" : "s"} available.`
            : state.message || "Not connected yet."}
        </span>
      </div>

      {state.status === "error" && state.message ? <div className="error-box">{state.message}</div> : null}

      <p className="muted">
        Reasoning models think at length before answering, and for pulling structured questions out of a source text
        that thinking is close to pure waste. Measured on a warm LM Studio model, the identical request took 5.7s and
        17.6s with reasoning on, against 0.6s and 0.7s with it off — same answer every time. Reasoning length also
        varies wildly run to run, which is what makes a long generation feel unpredictable. Turn it on only if
        question quality actually suffers. Servers that do not understand the switch simply ignore it.
      </p>

      <p className="muted">
        Parallel requests above 1 will contend for a single local GPU, and prompts running at the same time cannot see
        each other&apos;s questions, so cross-prompt duplicate avoidance gets weaker. Leave it at 1 unless your server
        batches well (vLLM, for example). Only local, private, and tailnet addresses are allowed; set{" "}
        <code>AI_ALLOWED_HOSTS</code> to permit others.
      </p>
    </section>
  );
}
