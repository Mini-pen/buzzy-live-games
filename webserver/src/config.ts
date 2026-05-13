import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Loads server configuration from the environment (`PORT`, `PUBLIC_URL`,
 * secrets, TTLs).
 */
export interface AppConfig {
  host: string;
  port: number;
  /** * Public URL with scheme, no trailing slash (QR links and redirects). */
  publicUrl: string;
  jwtSecret: string;
  /** * Delete parties untouched longer than this (ms). */
  partySweepMaxAgeMs: number;
  /** * How often to run the sweeper (ms). */
  partySweepIntervalMs: number;
  /** * Absolute or relative directory containing quiz JSON packs. */
  gamesDir: string;
  corsOrigin: boolean | string | string[];
}

function envString(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`Invalid integer for ${name}: ${v}`);
  return n;
}

export function loadConfig(): AppConfig {
  const isProd = process.env.NODE_ENV === "production";

  const host =
    process.env.HOST !== undefined && process.env.HOST !== ""
      ? process.env.HOST
      : "0.0.0.0";

  const publicUrlRaw = envString(
    "PUBLIC_URL",
    "http://127.0.0.1:5173",
  ).replace(/\/$/, "");

  const corsOrigin = process.env.CORS_ORIGIN;
  let corsParsed: AppConfig["corsOrigin"];
  if (corsOrigin === undefined || corsOrigin === "" || corsOrigin === "true") {
    corsParsed = true;
  } else if (corsOrigin === "false") {
    corsParsed = false;
  } else if (corsOrigin.includes(",")) {
    corsParsed = corsOrigin.split(",").map((s) => s.trim());
  } else {
    corsParsed = corsOrigin;
  }

  return {
    host,
    port: envInt("PORT", 3000),
    publicUrl: publicUrlRaw,
    jwtSecret: isProd
      ? envString("JWT_SECRET")
      : envString("JWT_SECRET", "dev-insecure-change-me"),
    partySweepIntervalMs: envInt("PARTY_SWEEP_INTERVAL_MS", 5 * 60 * 1000),
    partySweepMaxAgeMs: envInt(
      "PARTY_MAX_IDLE_MS",
      48 * 60 * 60 * 1000,
    ),
    gamesDir:
      process.env.GAMES_DIR !== undefined && process.env.GAMES_DIR !== ""
        ? process.env.GAMES_DIR
        : path.resolve(MODULE_DIR, "../../games"),
    corsOrigin: corsParsed,
  };
}
