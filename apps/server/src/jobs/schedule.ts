// Wall-clock times in Europe/Berlin for recurring jobs, independent of the
// server's TZ and correct across daylight saving changes.
import { isoDayInBerlin } from "@trespass/shared/format";

/** 'YYYY-MM-DD' + n days (UTC noon arithmetic keeps the calendar day stable). */
function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Berlin's offset from UTC at `at`, in ms (+1 h in winter, +2 h in summer). */
function berlinOffsetMs(at: number): number {
  const p = Object.fromEntries(PARTS.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return wall - Math.floor(at / 1000) * 1000;
}

/** The instant at which the Berlin clock shows `hour:minute` on `day` ('YYYY-MM-DD'). */
export function berlinTime(day: string, hour: number, minute = 0): Date {
  const wall = Date.parse(`${day}T00:00:00Z`) + (hour * 60 + minute) * 60_000;
  let t = wall - berlinOffsetMs(wall);
  t = wall - berlinOffsetMs(t);
  return new Date(t);
}

/** The next time after `now` at which the Berlin clock shows `hour:minute`. */
export function nextDailyInBerlin(now: Date, hour: number, minute = 0): Date {
  const today = isoDayInBerlin(now);
  const at = berlinTime(today, hour, minute);
  return at > now ? at : berlinTime(addDays(today, 1), hour, minute);
}
