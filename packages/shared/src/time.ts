import { DateTime } from "luxon";

const bkk = (utc: Date) => DateTime.fromJSDate(utc).setZone("Asia/Bangkok");

export const normalizeYear = (year: number): number => (year > 2400 ? year - 543 : year);

export const bangkokMonthKey = (utc: Date): string => bkk(utc).toFormat("yyyy-MM");

export const bangkokDay = (utc: Date): string => bkk(utc).toFormat("yyyy-MM-dd");

// [start, end) of a Bangkok day ("yyyy-MM-dd") as UTC instants. Bangkok is a fixed UTC+7 (no DST).
export const bangkokDayRange = (day: string): [Date, Date] => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const off = 7 * 3600_000;
  return [new Date(Date.UTC(y, m - 1, d) - off), new Date(Date.UTC(y, m - 1, d + 1) - off)];
};
