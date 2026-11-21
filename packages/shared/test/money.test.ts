import { describe, expect, it } from "vitest";
import { formatBaht, toSatang } from "../src/money";

describe("money", () => {
  it("toSatang rounds to integer satang", () => {
    expect(toSatang(80.5)).toBe(8050);
    expect(toSatang(0.1 + 0.2)).toBe(30);
  });
  it("formatBaht", () => {
    expect(formatBaht(8000)).toBe("80 บาท");
    expect(formatBaht(8050)).toBe("80.50 บาท");
  });
});
