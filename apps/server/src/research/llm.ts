// The research LLM (DESIGN §6.3 `extract`, §10). Claude is called with **no
// tools** and returns only JSON matching a schema (structured outputs), so
// crawled text can at most produce bad JSON values, never actions. Haiku 5.5
// extracts per page; Sonnet 5.5 writes the German summary. Every call is
// metered: the cost is added to the run and the monthly budget is checked
// before the next call. Tests inject a fake `Llm`.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { DbOrTx } from "../db/client";
import { researchRuns } from "../db/schema";
import { assertBudget } from "./budget";

export const EXTRACT_MODEL = "claude-haiku-5-5";
export const SUMMARY_MODEL = "claude-sonnet-5-5";

/** USD per million tokens (input, output). Haiku's rate is for prompts ≤ 100k tokens. */
const PRICES: Record<string, { input: number; output: number }> = {
  [EXTRACT_MODEL]: { input: 0.1, output: 0.5 },
  [SUMMARY_MODEL]: { input: 2, output: 10 },
};
/** Budgets are kept in cents; USD and EUR are treated alike (a rough cap, not billing). */
export function costCents(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? { input: 10, output: 50 };
  return ((inputTokens * p.input + outputTokens * p.output) / 1_000_000) * 100;
}

export type LlmUsage = { model: string; inputTokens: number; outputTokens: number };

export type JsonRequest<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type Llm = {
  /** Structured JSON; `value` is null when the model refused or the JSON did not parse. */
  json<T>(o: JsonRequest<T>): Promise<{ value: T | null; usage: LlmUsage }>;
  /** Plain German text (the summary). */
  text(o: { system: string; prompt: string; maxTokens?: number; signal?: AbortSignal }): Promise<{
    value: string | null;
    usage: LlmUsage;
  }>;
};

export function createAnthropicLlm(apiKey: string): Llm {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  return {
    async json<T>({ system, prompt, schema, maxTokens = 8000, signal }: JsonRequest<T>) {
      const res = await client.messages.parse(
        {
          model: EXTRACT_MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: prompt }],
          output_config: { effort: "low", format: zodOutputFormat(schema) },
        },
        { signal },
      );
      const usage = {
        model: EXTRACT_MODEL,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      };
      if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
        return { value: null, usage };
      }
      return { value: (res.parsed_output as T | null) ?? null, usage };
    },
    async text({ system, prompt, maxTokens = 4000, signal }) {
      const res = await client.beta.messages.create(
        {
          model: SUMMARY_MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: prompt }],
          output_config: { effort: "low" },
          // On a safety decline the API re-runs the request on a fallback model.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal },
      );
      const usage = {
        model: res.model ?? SUMMARY_MODEL,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      };
      if (res.stop_reason === "refusal") return { value: null, usage };
      const text = res.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      return { value: text || null, usage };
    },
  };
}

export function addRunCost(db: DbOrTx, runId: string, cents: number) {
  if (!(cents > 0)) return;
  db.update(researchRuns)
    .set({ costCents: sql`${researchRuns.costCents} + ${cents}` })
    .where(eq(researchRuns.id, runId))
    .run();
}

/** Wraps an Llm: checks the budget before and books the cost after every call. */
export function meteredLlm(
  db: DbOrTx,
  runId: string,
  inner: Llm,
  now: () => Date = () => new Date(),
): Llm {
  const book = (u: LlmUsage) =>
    addRunCost(db, runId, costCents(u.model, u.inputTokens, u.outputTokens));
  return {
    async json<T>(o: JsonRequest<T>) {
      assertBudget(db, now());
      const r = await inner.json(o);
      book(r.usage);
      return r;
    },
    async text(o) {
      assertBudget(db, now());
      const r = await inner.text(o);
      book(r.usage);
      return r;
    },
  };
}
