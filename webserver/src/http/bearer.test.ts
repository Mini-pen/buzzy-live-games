import { describe, expect, it } from "vitest";

import { readBearer } from "./bearer.js";

describe("readBearer", () => {
  it("returns null when header is missing", () => {
    expect(readBearer(undefined)).toBeNull();
  });

  it("returns null when header is not Bearer scheme", () => {
    expect(readBearer("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("returns null when token is empty", () => {
    expect(readBearer("Bearer ")).toBeNull();
    expect(readBearer("Bearer   ")).toBeNull();
  });

  it("extracts token from normal Bearer header", () => {
    expect(readBearer("Bearer abc123xyz")).toBe("abc123xyz");
  });

  it("handles scheme case insensitively", () => {
    expect(readBearer("bearer token123")).toBe("token123");
    expect(readBearer("BEARER token456")).toBe("token456");
    expect(readBearer("BeArEr token789")).toBe("token789");
  });

  it("trims whitespace around token", () => {
    expect(readBearer("Bearer   token-with-spaces   ")).toBe("token-with-spaces");
  });

  it("trims whitespace around entire header", () => {
    expect(readBearer("  Bearer mytoken  ")).toBe("mytoken");
  });
});
