import { NextResponse } from "next/server";
import { defaultBaseUrl, isAllowedAiHost } from "@/lib/ai/allowlist";
import {
  modelsUrl,
  normalizeBaseUrl,
  parseModelList,
  probeOrder,
  withOpenAiSuffix
} from "@/lib/ai/provider";
import type { AiProviderKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 8000;

type ProbeResult =
  /** Right shape, at least one model. */
  | { outcome: "models"; models: string[] }
  /** Right shape, but the server has nothing loaded. */
  | { outcome: "empty" }
  /** Answered, but this is not that provider's API. */
  | { outcome: "mismatch"; detail: string }
  /** Never got a usable answer. */
  | { outcome: "unreachable"; detail: string };

function endpointFor(baseUrl: string, kind: AiProviderKind): string {
  return modelsUrl(kind === "openai-compatible" ? withOpenAiSuffix(baseUrl) : baseUrl, kind);
}

async function probe(baseUrl: string, kind: AiProviderKind): Promise<ProbeResult> {
  const url = endpointFor(baseUrl, kind);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store"
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const detail = timedOut
      ? `no response within ${PROBE_TIMEOUT_MS / 1000}s`
      : error instanceof Error
        ? error.message
        : "request failed";
    return { outcome: "unreachable", detail };
  }

  if (!response.ok) {
    return { outcome: "mismatch", detail: `HTTP ${response.status}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { outcome: "mismatch", detail: "response was not JSON" };
  }

  // A 200 is not proof of a match: LM Studio returns 200 with an error body for
  // endpoints it does not implement, so the payload shape is what decides.
  const models = parseModelList(kind, payload);
  if (models === null) {
    return { outcome: "mismatch", detail: "response did not look like this provider's model list" };
  }

  return models.length > 0 ? { outcome: "models", models } : { outcome: "empty" };
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("baseUrl")?.trim();
  const baseUrl = normalizeBaseUrl(requested && requested.length > 0 ? requested : defaultBaseUrl());

  const guard = isAllowedAiHost(baseUrl);
  if (!guard.allowed) {
    return NextResponse.json({ error: guard.reason }, { status: 400 });
  }

  const order = probeOrder(baseUrl);
  const attempted: { kind: AiProviderKind; endpoint: string; result: ProbeResult }[] = [];

  for (const kind of order) {
    const result = await probe(baseUrl, kind);
    attempted.push({ kind, endpoint: endpointFor(baseUrl, kind), result });

    if (result.outcome === "models") {
      return NextResponse.json({
        kind,
        baseUrl: kind === "openai-compatible" ? withOpenAiSuffix(baseUrl) : baseUrl,
        models: result.models
      });
    }
  }

  // Reached a real server that simply has nothing loaded. Worth saying plainly
  // rather than reporting it as unreachable.
  const empty = attempted.find((entry) => entry.result.outcome === "empty");
  if (empty) {
    return NextResponse.json(
      {
        error: `Connected to ${empty.kind === "ollama" ? "an Ollama" : "an OpenAI-compatible"} server at ${empty.endpoint}, but it reports no models. Load or pull a model, then test again.`
      },
      { status: 502 }
    );
  }

  const detail = attempted
    .map((entry) => {
      const result = entry.result;
      const reason = result.outcome === "unreachable" ? result.detail : (result as { detail: string }).detail;
      return `${entry.endpoint} (${reason})`;
    })
    .join("; ");

  return NextResponse.json(
    {
      error: `Could not find a model server at ${baseUrl}. Tried ${detail}. Check the server is running and that this address is right — for LM Studio and llama.cpp the base URL usually ends in /v1.`
    },
    { status: 502 }
  );
}
