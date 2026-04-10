import { describe, it, expect } from "vitest";
import { cn, distance2D, distance3D } from "./utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });
});

describe("distance2D", () => {
  it("calculates 2D euclidean distance", () => {
    const a = { x: 0, y: 0, z: 0, visibility: 1 };
    const b = { x: 3, y: 4, z: 99, visibility: 1 };
    expect(distance2D(a, b)).toBeCloseTo(5);
  });
});

describe("distance3D", () => {
  it("calculates 3D euclidean distance", () => {
    const a = { x: 0, y: 0, z: 0, visibility: 1 };
    const b = { x: 1, y: 2, z: 2, visibility: 1 };
    expect(distance3D(a, b)).toBeCloseTo(3);
  });
});
