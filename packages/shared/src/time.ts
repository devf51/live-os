import { DateTime } from "luxon";

const bkk = (utc: Date) => DateTime.fromJSDate(utc).setZone("Asia/Bangkok");

export const normalizeYear = (year: number): number => (year > 2400 ? year - 543 : year);

export const bangkokMonthKey = (utc: Date): string => bkk(utc).toFormat("yyyy-MM");

export const bangkokDay = (utc: Date): string => bkk(utc).toFormat("yyyy-MM-dd");
