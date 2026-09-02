import { describe, expect, it } from "vitest";
import { filterResourcesByRegion, resourceRegionFilter } from "./care-region";

const ROWS = [
  { id: "us1", region: "US" },
  { id: "us2", region: "US" },
  { id: "uni1", region: null },
  { id: "uni2", region: null },
];

describe("resourceRegionFilter", () => {
  it("keeps US rows for English and unknown languages", () => {
    expect(resourceRegionFilter("en").countries).toEqual(["US"]);
    expect(resourceRegionFilter(null).countries).toEqual(["US"]);
    expect(resourceRegionFilter("de").countries).toEqual(["US"]);
  });

  it("drops region-specific rows for fr / ar (universal only)", () => {
    expect(resourceRegionFilter("fr").countries).toEqual([]);
    expect(resourceRegionFilter("AR").countries).toEqual([]);
  });
});

describe("filterResourcesByRegion", () => {
  it("English user sees US + universal", () => {
    expect(filterResourcesByRegion(ROWS, "en").map((r) => r.id)).toEqual([
      "us1",
      "us2",
      "uni1",
      "uni2",
    ]);
  });

  it("French user sees only the universal rows", () => {
    expect(filterResourcesByRegion(ROWS, "fr").map((r) => r.id)).toEqual(["uni1", "uni2"]);
  });

  it("Arabic user sees only the universal rows", () => {
    expect(filterResourcesByRegion(ROWS, "ar").map((r) => r.id)).toEqual(["uni1", "uni2"]);
  });

  it("never removes a universal (region === null) row for anyone", () => {
    for (const lang of ["en", "fr", "ar", null, "xx"]) {
      const ids = filterResourcesByRegion(ROWS, lang).map((r) => r.id);
      expect(ids).toContain("uni1");
      expect(ids).toContain("uni2");
    }
  });
});
