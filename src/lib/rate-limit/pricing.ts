// Rough per-million-token prices for a $ estimate on the usage counter. NOT a
// billing source of truth — update when provider pricing changes, and treat the
// output as indicative only. Unknown models fall back to the Sonnet rate.
import type { UsageRecord } from "./types";

type Price = { inPerM: number; outPerM: number };

const FALLBACK: Price = { inPerM: 3, outPerM: 15 }; // Sonnet-class rate

const PRICING: Record<string, Price> = {
  "claude-sonnet-5": FALLBACK,
  "claude-sonnet-4-5": FALLBACK,
  "claude-haiku-4-5": { inPerM: 1, outPerM: 5 },
  "google/gemini-3.6-flash": { inPerM: 0.3, outPerM: 2.5 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model] ?? FALLBACK;
  return (inputTokens / 1_000_000) * price.inPerM + (outputTokens / 1_000_000) * price.outPerM;
}

export function estimateRecordCostUsd(usage: UsageRecord): number {
  return estimateCostUsd(usage.model, usage.inputTokens, usage.outputTokens);
}
