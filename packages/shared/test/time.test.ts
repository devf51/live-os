import { describe, expect, it } from "vitest";
import { bangkokDay, bangkokDayRange, bangkokMonthKey, normalizeYear } from "../src/time";

describe("time", () => {
  it("normalizeYear converts Buddhist era", () => {
    expect(normalizeYear(2569)).toBe(2026);
    expect(normalizeYear(2026)).toBe(2026);
  });
  it("bangkokMonthKey uses Bangkok zone", () => {
    expect(bangkokMonthKey(new Date("2026-11-30T17:30:00Z"))).toBe("2026-12");
  });
  it("bangkokDay uses Bangkok zone", () => {
    expect(bangkokDay(new Date("2026-11-30T16:59:00Z"))).toBe("2026-11-30");
  });
  it("bangkokDayRange is [00:00, next 00:00) Bangkok in UTC", () => {
    const [a, b] = bangkokDayRange("2026-11-30");
    expect(a.toISOString()).toBe("2026-11-29T17:00:00.000Z");
    expect(b.toISOString()).toBe("2026-11-30T17:00:00.000Z");
  });
});
