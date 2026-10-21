import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { fitFontSizePx, PLAY_LAYOUT } from "./playLayout.js";
import {
  QUESTION_PROMPT_MAX_GRAPHEMES,
  textLimitCounter,
  textLimitTone,
} from "./quizTextLimits.js";
import { pickReadyPhaseTagline, READY_PHASE_TAGLINES } from "./readyPhaseTaglines.js";
import { PartyStore } from "./store.js";
import type { Party } from "./types.js";

/**
 * * Rules already implemented on main: phrase rotation, minimum fonts, and the
 *   fixed question zone. Pixel layout stays in the Playwright todos.
 */

const buzzCatalog: BuzzSoundCatalog = {
  sounds: [
    { key: "good1", label: "Good", pool: "good", file: "buzzers/good1.mp3" },
    { key: "bad1", label: "Bad", pool: "bad", file: "buzzers/bad1.mp3" },
  ],
  goodPool: ["good1"],
  badPool: ["bad1"],
  byKey: new Map([
    ["good1", { key: "good1", label: "Good", pool: "good", file: "buzzers/good1.mp3" }],
    ["bad1", { key: "bad1", label: "Bad", pool: "bad", file: "buzzers/bad1.mp3" }],
  ]),
  defaultBuzzerKey: "good1",
};

const stylesheet = readFileSync(new URL("../../client/src/styles/buzzy.css", import.meta.url), "utf8");

function ruleBodies(selector: string): string[] {
  const needle = `${selector} {`;
  const bodies: string[] = [];
  let from = 0;
  while (from < stylesheet.length) {
    const start = stylesheet.indexOf(needle, from);
    if (start < 0) break;
    const open = stylesheet.indexOf("{", start);
    const close = stylesheet.indexOf("}", open);
    bodies.push(stylesheet.slice(open, close + 1));
    from = close + 1;
  }
  expect(bodies.length, selector).toBeGreaterThan(0);
  return bodies;
}

function ruleBody(selector: string): string {
  return ruleBodies(selector)[0] ?? "";
}

function launchReadyParty(): { store: PartyStore; party: Party; quiz: QuizPack } {
  const store = new PartyStore(() => {}, buzzCatalog);
  const party = store.createParty({
    maxPlayers: null,
    maxTeams: null,
    closedAfterStart: false,
    allowRename: true,
    allowTeamChange: true,
  });
  party.players.set("alice", {
    id: "alice",
    displayName: "Alice",
    avatarKey: "a.png",
    buzzSoundKey: "good1",
    teamId: null,
    score: 0,
    joinedAt: 1,
  });
  const quiz: QuizPack = {
    id: "pack-rules",
    basename: "pack-rules",
    title: "Pack",
    rounds: [
      {
        title: "Manche",
        questions: [
          { prompt: "Q1", choices: ["A", "B"], correctIndex: 0, points: 10 },
          { prompt: "Q2", choices: ["A", "B"], correctIndex: 1, points: 10 },
        ],
      },
    ],
  };
  const packs = new Map<string, QuizPack>([[quiz.id, quiz]]);
  store.hostAppendManche(party, {
    kind: "pack_quiz",
    title: quiz.title,
    packBasename: quiz.basename,
    iframeUrl: null,
    youtubeEmbedUrl: null,
    directVideoUrl: null,
    savedRoundIndex: 0,
    savedQuestionIndex: 0,
    transitionKind: null,
    transitionDurationMs: null,
  });
  store.adminSetReadyCheckEnabled(party, true, quiz);
  store.adminSetCountdownDuration(party, 0);
  store.adminSetNextQuestionCountdownSec(party, 0);
  store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", true, packs);
  return { store, party, quiz };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ready phrase rotation", () => {
  it("skips the previous phrase when the random index lands on it", () => {
    const phrases = ["Une", "Deux", "Trois"];
    expect(pickReadyPhaseTagline("Une", 0, phrases)).toBe("Deux");
    expect(pickReadyPhaseTagline("Deux", 1 / 3, phrases)).toBe("Trois");
    expect(pickReadyPhaseTagline("Trois", 2 / 3, phrases)).toBe("Une");
    expect(pickReadyPhaseTagline("Une", 0.5, phrases)).toBe("Deux");
    expect(pickReadyPhaseTagline("Seul", 0.4, ["Seul"])).toBe("Seul");
    expect(pickReadyPhaseTagline(null, 0.2, [])).toBe("");
    expect(pickReadyPhaseTagline(null, Number.NaN, phrases)).toBe("Une");
  });

  it("stores a new phrase for the next ready phase when the draw repeats", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { store, party, quiz } = launchReadyParty();
    const first = party.readyPhaseTagline ?? "";
    expect(READY_PHASE_TAGLINES).toContain(first);
    expect(party.lastReadyPhaseTagline).toBe(first);

    store.playerSetReady(party, "alice", true);
    expect(party.buzzWindowOpen).toBe(true);
    party.buzzOrder = ["alice"];
    store.adminValidateBuzzAnswer(party, "alice", "good", quiz);
    store.adminAdvanceCue(party, quiz);

    const second = party.readyPhaseTagline ?? "";
    expect(READY_PHASE_TAGLINES).toContain(second);
    expect(second).not.toBe(first);
    expect(party.lastReadyPhaseTagline).toBe(second);
  });
});

describe("fixed question zone", () => {
  it("keeps the decided minimum fonts and clips instead of scrolling", () => {
    expect(PLAY_LAYOUT.questionFontMinPx).toBe(14);
    expect(PLAY_LAYOUT.answerFontMinPx).toBe(10);

    const tooWide = (): number => 10_000;
    expect(
      fitFontSizePx({
        text: "un mot qui ne tient pas",
        maxWidthPx: 40,
        maxHeightPx: 20,
        maxLines: 3,
        maxPx: PLAY_LAYOUT.questionFontMaxPx,
        minPx: PLAY_LAYOUT.questionFontMinPx,
        lineHeight: 1.2,
        measureWidth: tooWide,
      }),
    ).toEqual({ fontPx: 14, needsClamp: true });

    const narrow = (text: string, fontPx: number): number => text.length * fontPx * 0.5;
    const fitted = fitFontSizePx({
      text: "Oui",
      maxWidthPx: 200,
      maxHeightPx: 80,
      maxLines: 3,
      maxPx: PLAY_LAYOUT.questionFontMaxPx,
      minPx: PLAY_LAYOUT.questionFontMinPx,
      lineHeight: 1.2,
      measureWidth: narrow,
    });
    expect(fitted.needsClamp).toBe(false);
    expect(fitted.fontPx).toBe(PLAY_LAYOUT.questionFontMaxPx);
  });

  it("hides overflow on the question zone, the answers and the buzzer slot", () => {
    for (const selector of [".bz-play-rest", ".bz-qna", ".bz-buzz-slot"]) {
      expect(ruleBody(selector)).toContain("overflow: hidden");
    }
    const clipped = stylesheet.slice(
      stylesheet.indexOf(".bz-qna-question,"),
      stylesheet.indexOf(".bz-qna-kicker"),
    );
    expect(clipped).toContain("overflow: hidden");
    expect(clipped.includes("overflow: auto")).toBe(false);
    expect(clipped.includes("overflow: scroll")).toBe(false);
  });

  it("paints the ready button and the list mark orange, then green", () => {
    expect(ruleBody(".bz-app .bz-buzz-btn.bz-buzz-ready")).toContain("background: #f07800");
    expect(ruleBody(".bz-app .bz-buzz-btn.bz-buzz-ready.is-ready")).toContain("background: #1e7a3c");
    expect(ruleBody(".bz-ready-mark")).toContain("color: #f07800");
    expect(ruleBody(".bz-ready-mark.is-ready")).toContain("color: #1e7a3c");
    expect(ruleBody(".bz-app .bz-choice--selected,\n.bz-app .bz-qna-answers .bz-choice--selected")).toContain(
      "outline: 3px solid #ffca28",
    );
    expect(ruleBodies(".bz-app .bz-choice--correct").some((body) => body.includes("background: #1e7a3c"))).toBe(
      true,
    );
  });
});

describe("editor character counter", () => {
  it("prints 128 / 140 and turns orange from 85 percent", () => {
    expect(textLimitCounter(128, QUESTION_PROMPT_MAX_GRAPHEMES)).toBe("128 / 140");
    expect(textLimitTone(128, QUESTION_PROMPT_MAX_GRAPHEMES)).toBe("warn");
    expect(textLimitCounter(141, QUESTION_PROMPT_MAX_GRAPHEMES)).toBe("141 / 140");
    expect(textLimitTone(141, QUESTION_PROMPT_MAX_GRAPHEMES)).toBe("over");
  });
});
