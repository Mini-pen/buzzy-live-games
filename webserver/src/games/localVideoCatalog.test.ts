import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  assertDirectVideoUrlForPartyManche,
  listHostedGameVideos,
} from "./localVideoCatalog.js";

describe("listHostedGameVideos", () => {
  test("returns [] when folder missing", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bz-vids-"));
    expect(await listHostedGameVideos(tmp)).toEqual([]);
  });

  test("lists video extensions only", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bz-vids-"));
    const vdir = path.join(tmp, "video");
    await fs.mkdir(vdir, { recursive: true });
    await fs.writeFile(path.join(vdir, "a.mp4"), Buffer.alloc(8));
    await fs.writeFile(path.join(vdir, "b.txt"), "x");

    const list = await listHostedGameVideos(tmp);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("a.mp4");
    expect(list[0]?.url).toBe("/games/video/a.mp4");
  });
});

describe("assertDirectVideoUrlForPartyManche", () => {
  test("accepts HTTPS URL", () => {
    expect(
      assertDirectVideoUrlForPartyManche(
        "/tmp",
        "https://example.com/stream.m3u8",
      ),
    ).toBe("https://example.com/stream.m3u8");
  });

  test("accepts hosted file when present", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bz-vids-"));
    const vdir = path.join(tmp, "video");
    await fs.mkdir(vdir, { recursive: true });
    await fs.writeFile(path.join(vdir, "clip.mp4"), Buffer.alloc(4));

    expect(assertDirectVideoUrlForPartyManche(tmp, "/games/video/clip.mp4")).toBe(
      "/games/video/clip.mp4",
    );
  });

  test("rejects traversal", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bz-vids-"));
    await fs.mkdir(path.join(tmp, "video"), { recursive: true });

    expect(() =>
      assertDirectVideoUrlForPartyManche(tmp, "/games/video/../../../etc/passwd"),
    ).toThrow();
  });
});
