import { afterEach, describe, expect, test } from "vitest";

import {
  getBasePath,
  normaliseBasePath,
  setBasePath,
  withBasePath,
} from "./basePath.js";

afterEach(() => {
  // * Restore the module singleton so other test files see the root-mount default.
  setBasePath("");
});

describe("normaliseBasePath", () => {
  test("empty / undefined / slash collapse to root", () => {
    expect(normaliseBasePath(undefined)).toBe("");
    expect(normaliseBasePath("")).toBe("");
    expect(normaliseBasePath("   ")).toBe("");
    expect(normaliseBasePath("/")).toBe("");
    expect(normaliseBasePath("///")).toBe("");
  });

  test("adds a leading slash and trims trailing slashes", () => {
    expect(normaliseBasePath("buzzy-live-games")).toBe("/buzzy-live-games");
    expect(normaliseBasePath("/buzzy-live-games/")).toBe("/buzzy-live-games");
    expect(normaliseBasePath("  /buzzy-live-games//  ")).toBe("/buzzy-live-games");
  });
});

describe("withBasePath", () => {
  test("no-op at the domain root", () => {
    setBasePath("");
    expect(getBasePath()).toBe("");
    expect(withBasePath("/games/sounds/a.mp3")).toBe("/games/sounds/a.mp3");
  });

  test("prefixes root-relative paths once a mount path is set", () => {
    setBasePath("/buzzy-live-games");
    expect(withBasePath("/games/sounds/a.mp3")).toBe("/buzzy-live-games/games/sounds/a.mp3");
    expect(withBasePath("/avatars/")).toBe("/buzzy-live-games/avatars/");
  });

  test("leaves absolute and non-root URLs untouched", () => {
    setBasePath("/buzzy-live-games");
    expect(withBasePath("https://cdn.example/x.mp3")).toBe("https://cdn.example/x.mp3");
    expect(withBasePath("")).toBe("");
  });
});
