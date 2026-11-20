import { describe, expect, it } from "vitest";
import { bangkokDay, bangkokMonthKey, normalizeYear } from "../src/time";

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
});
