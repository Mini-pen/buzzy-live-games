// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// * Probed in happy-dom: a 680px column with the podium rules yields no distinct step heights.
//   312 / 231 / 176 px stay a browser check.

/**
 * * Phone podium staircase. The stylesheet declares 46% / 34% / 26%, not 312 / 231 / 176 px.
 *   happy-dom does not lay out percentage min-heights, so the pixel check stays a Playwright todo.
 */

function declaredMinHeight(sheet: string, rank: 1 | 2 | 3): number {
  const match = sheet.match(new RegExp(`\\.bz-podium-step--r${rank} \\{[^}]*min-height:\\s*([\\d.]+)%`));
  if (match === null) throw new Error(`missing min-height for rank ${rank}`);
  return Number(match[1]);
}

describe("podium téléphone en escalier", () => {
  it("ordonne les hauteurs déclarées : 1re marche, puis 2e, puis 3e", () => {
    const sheet = readFileSync("client/src/styles/buzzy.css", "utf8");
    const first = declaredMinHeight(sheet, 1);
    const second = declaredMinHeight(sheet, 2);
    const third = declaredMinHeight(sheet, 3);
    expect(first).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(third);
    expect([first, second, third]).toEqual([46, 34, 26]);
  });

  it.todo("Playwright: marches téléphone 312 / 231 / 176 px");
});
