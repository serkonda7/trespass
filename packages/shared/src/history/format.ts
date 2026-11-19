// German display of history dates (DESIGN §5.4). Pure, used by UI and export.
import { m } from "../paraglide/messages";
import type { HistoryPrecision } from "./inputs";

const MONTH = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

function one(value: string, precision: HistoryPrecision): string {
  switch (precision) {
    case "day": {
      const [y, mo, d] = value.split("-");
      return `${d}.${mo}.${y}`;
    }
    case "month": {
      const [y, mo] = value.split("-");
      return MONTH.format(new Date(Date.UTC(Number(y), Number(mo) - 1, 15)));
    }
    case "year":
      return value.replace(/^0+(?=\d)/, "");
    case "decade":
      return m.history_decade({ year: value.replace(/^0+(?=\d)/, "") });
    case "circa":
      return m.history_circa({ year: value.replace(/^0+(?=\d)/, "") });
  }
}

/** "12.05.1923", "Mai 1923", "1923", "1920er", "um 1923"; ranges with an en dash. */
export function formatHistoryDate(
  from: string,
  to: string | null | undefined,
  precision: HistoryPrecision,
): string {
  const a = one(from, precision);
  if (!to || to === from) return a;
  return `${a} – ${one(to, precision)}`;
}
