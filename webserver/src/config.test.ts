import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("loads with defaults", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
    };

    const config = loadConfig();
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(3000);
    expect(config.publicUrl).toBe("http://localhost:3000");
    expect(config.jwtSecret).toBe("dev-insecure-change-me");
    expect(config.basePath).toBe("");
    expect(config.corsOrigin).toBe(true);
  });

  it("requires JWT_SECRET in production", () => {
    process.env = {
      NODE_ENV: "production",
      PUBLIC_URL: "https://example.com",
    };

    expect(() => loadConfig()).toThrow("Missing required environment variable: JWT_SECRET");
  });

  it("accepts JWT_SECRET in production", () => {
    process.env = {
      NODE_ENV: "production",
      PUBLIC_URL: "https://example.com",
      JWT_SECRET: "my-secret-key",
    };

    const config = loadConfig();
    expect(config.jwtSecret).toBe("my-secret-key");
  });

  it("throws on invalid integer", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
      PORT: "not-a-number",
    };

    expect(() => loadConfig()).toThrow("Invalid integer for PORT: not-a-number");
  });

  it("parses CORS_ORIGIN as true by default", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
    };

    const config = loadConfig();
    expect(config.corsOrigin).toBe(true);
  });

  it("parses CORS_ORIGIN as true when explicitly set", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
      CORS_ORIGIN: "true",
    };

    const config = loadConfig();
    expect(config.corsOrigin).toBe(true);
  });

  it("parses CORS_ORIGIN as false", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
      CORS_ORIGIN: "false",
    };

    const config = loadConfig();
    expect(config.corsOrigin).toBe(false);
  });

  it("parses CORS_ORIGIN as single origin string", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
      CORS_ORIGIN: "https://example.com",
    };

    const config = loadConfig();
    expect(config.corsOrigin).toBe("https://example.com");
  });

  it("parses CORS_ORIGIN as array when comma-separated", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
      CORS_ORIGIN: "https://example.com,https://app.example.com,http://localhost:5173",
    };

    const config = loadConfig();
    expect(config.corsOrigin).toEqual([
      "https://example.com",
      "https://app.example.com",
      "http://localhost:5173",
    ]);
  });

  it("strips trailing slash from PUBLIC_URL", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000/",
    };

    const config = loadConfig();
    expect(config.publicUrl).toBe("http://localhost:3000");
  });

  it("strips trailing slash from PUBLIC_URL with path", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000/app/",
    };

    const config = loadConfig();
    expect(config.publicUrl).toBe("http://localhost:3000/app");
  });

  it("normalizes BASE_PATH with leading slash", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
      BASE_PATH: "api",
    };

    const config = loadConfig();
    expect(config.basePath).toBe("/api");
  });

  it("normalizes BASE_PATH by removing trailing slash", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
      BASE_PATH: "/api/",
    };

    const config = loadConfig();
    expect(config.basePath).toBe("/api");
  });

  it("normalizes BASE_PATH root to empty string", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
      BASE_PATH: "/",
    };

    const config = loadConfig();
    expect(config.basePath).toBe("");
  });

  it("parses PORT override", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
      PORT: "8080",
    };

    const config = loadConfig();
    expect(config.port).toBe(8080);
  });

  it("parses HOST override", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
      HOST: "127.0.0.1",
    };

    const config = loadConfig();
    expect(config.host).toBe("127.0.0.1");
  });

  it("parses PARTY_SWEEP_INTERVAL_MS", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
      PARTY_SWEEP_INTERVAL_MS: "60000",
    };

    const config = loadConfig();
    expect(config.partySweepIntervalMs).toBe(60000);
  });

  it("parses PARTY_MAX_IDLE_MS", () => {
    process.env = {
      NODE_ENV: "development",
      PUBLIC_URL: "http://localhost:3000",
      PARTY_MAX_IDLE_MS: "3600000",
    };

    const config = loadConfig();
    expect(config.partySweepMaxAgeMs).toBe(3600000);
  });
});
