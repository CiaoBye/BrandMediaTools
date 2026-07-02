import { beijingDate } from "./time.mjs";

function parseField(field, min, max) {
  const values = new Set();
  const parts = String(field || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const part of parts) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) return null;
    let start = min;
    let end = max;
    if (rangePart !== "*") {
      if (rangePart.includes("-")) {
        const [a, b] = rangePart.split("-").map(Number);
        if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
        start = a;
        end = b;
      } else {
        const n = Number(rangePart);
        if (!Number.isInteger(n)) return null;
        start = n;
        end = n;
      }
    }
    if (start < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

export function parseCronExpression(expr) {
  const fields = String(expr || "").trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, day, month, weekday] = fields;
  const parsed = {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    day: parseField(day, 1, 31),
    month: parseField(month, 1, 12),
    weekday: parseField(weekday, 0, 7)
  };
  if (Object.values(parsed).some((value) => !value)) return null;
  if (parsed.weekday.has(7)) {
    parsed.weekday.add(0);
    parsed.weekday.delete(7);
  }
  return parsed;
}

export function isValidCron(expr) {
  return Boolean(parseCronExpression(expr));
}

function matchesCron(date, cron) {
  const bj = beijingDate(date);
  return cron.minute.has(bj.getUTCMinutes()) &&
    cron.hour.has(bj.getUTCHours()) &&
    cron.day.has(bj.getUTCDate()) &&
    cron.month.has(bj.getUTCMonth() + 1) &&
    cron.weekday.has(bj.getUTCDay());
}

function toBeijingIso(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:00+08:00`;
}

export function nextCronRun(expr, from = new Date()) {
  const cron = parseCronExpression(expr);
  if (!cron) return "";
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return "";
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  const maxMinutes = 366 * 24 * 60;
  for (let i = 0; i < maxMinutes; i += 1) {
    const candidate = new Date(start.getTime() + i * 60 * 1000);
    if (matchesCron(candidate, cron)) return toBeijingIso(candidate);
  }
  return "";
}
