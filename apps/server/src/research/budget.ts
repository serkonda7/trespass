// Monthly LLM budget (DESIGN §6.1): settings.research_budget_cents per Berlin
// calendar month, summed over research_runs.cost_cents. A limit of 0 means no
// LLM use at all. Jobs check before every call and stop with status `budget`.
import { isoDayInBerlin } from "@trespass/shared/format";
import type { ResearchBudget } from "@trespass/shared/research/types";
import { eq, gte, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { researchRuns, settings } from "../db/schema";
import { getEnv } from "../env";
import { berlinTime } from "../jobs/schedule";

export class BudgetExceeded extends Error {
  constructor() {
    super("research budget reached");
    this.name = "BudgetExceeded";
  }
}

export const monthOf = (now: Date) => isoDayInBerlin(now).slice(0, 7);
export const monthStart = (now: Date) => berlinTime(`${monthOf(now)}-01`, 0);

export function monthSpentCents(db: DbOrTx, now: Date = new Date()): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${researchRuns.costCents}), 0)` })
    .from(researchRuns)
    .where(gte(researchRuns.createdAt, monthStart(now)))
    .get();
  return Number(row?.total ?? 0);
}

export function budgetLimitCents(db: DbOrTx): number {
  return (
    db.select({ v: settings.researchBudgetCents }).from(settings).where(eq(settings.id, 1)).get()
      ?.v ?? 0
  );
}

/** Throws BudgetExceeded when this month's spend has reached the limit. */
export function assertBudget(db: DbOrTx, now: Date = new Date()) {
  const limit = budgetLimitCents(db);
  if (limit <= 0 || monthSpentCents(db, now) >= limit) throw new BudgetExceeded();
}

export function researchBudget(db: DbOrTx, now: Date = new Date()): ResearchBudget {
  const env = getEnv();
  return {
    month: monthOf(now),
    limitCents: budgetLimitCents(db),
    spentCents: Math.round(monthSpentCents(db, now) * 100) / 100,
    llmConfigured: Boolean(env.ANTHROPIC_API_KEY),
    webSearchConfigured: Boolean(env.SEARXNG_URL),
    enabled: env.RESEARCH === "on",
  };
}
