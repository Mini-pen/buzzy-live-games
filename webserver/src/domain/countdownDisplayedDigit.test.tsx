// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { nextQuestionCountdownRemainingSec } from "./nextQuestionCountdown.js";
import { releaseRenderedScreens, showPartyScreen } from "./renderPartyScreen.js";
import { PartyStore } from "./store.js";
import type { Party, PartyPublicSnapshot } from "./types.js";

/**
 * * The digit on the phone disc and the broadcast must not exceed the configured length.
 *   A client clock 50 ms behind the server start used to show 6 for a 5 s countdown.
 */

const buzzCatalog: LoadedBuzzSoundCatalog = {
  defaultBuzzerKey: "good1",
  sounds: [
    { key: "good1", label: "Good", pool: "good", file: "buzzers/good1.mp3" },
    { key: "bad1", label: "Bad", pool: "bad", file: "buzzers/bad1.mp3" },
  ],
  byKey: new Map([
    ["good1", { key: "good1", label: "Good", pool: "good", file: "buzzers/good1.mp3" }],
    ["bad1", { key: "bad1", label: "Bad", pool: "bad", file: "buzzers/bad1.mp3" }],
  ]),
};

interface ClockCase {
  durationSec: number;
  offsetMs: number;
  shown: number;
}

const CASES: ClockCase[] = [
  { durationSec: 5, offsetMs: -50, shown: 5 },
  { durationSec: 5, offsetMs: 50, shown: 5 },
  { durationSec: 5, offsetMs: 0, shown: 5 },
  { durationSec: 5, offsetMs: 5_000, shown: 0 },
  { durationSec: 2, offsetMs: -50, shown: 2 },
  { durationSec: 2, offsetMs: 50, shown: 2 },
  { durationSec: 2, offsetMs: 0, shown: 2 },
  { durationSec: 2, offsetMs: 2_000, shown: 0 },
  { durationSec: 0, offsetMs: -50, shown: 0 },
  { durationSec: 0, offsetMs: 50, shown: 0 },
  { durationSec: 0, offsetMs: 0, shown: 0 },
];

function countingParty(durationSec: number, offsetMs: number): { party: Party; snap: PartyPublicSnapshot } {
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
  party.state = "round_active";
  party.hasStartedRound = true;
  party.buzzWindowOpen = false;
  party.countdownDurationSec = durationSec;
  party.appliedCountdownDurationSec = durationSec;
  party.countdownStartedAt = Date.now() - offsetMs;
  const snap = partySnapshotWithGame(party, new Map<string, QuizPack>(), "player");
  return { party, snap };
}

function phoneDigit(container: HTMLElement): string | null {
  return container.querySelector(".bz-buzz-count-num")?.textContent?.trim() ?? null;
}

function broadcastDigit(container: HTMLElement): string | null {
  return container.querySelector(".bz-countdown-digit")?.textContent?.trim() ?? null;
}

afterEach(async () => {
  await releaseRenderedScreens();
});

describe("chiffre de décompte plafonné", () => {
  it("ne dépasse jamais la durée dans le calcul, pour 0 s, 2 s et 5 s", () => {
    const startedAt = 1_000_000;
    for (const row of CASES) {
      const shown = nextQuestionCountdownRemainingSec(startedAt, row.durationSec, startedAt + row.offsetMs);
      expect(shown).toBe(row.shown);
      expect(shown).toBeLessThanOrEqual(row.durationSec);
    }
  });

  it("affiche ce plafond sur le téléphone et sur la diffusion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
    for (const row of CASES) {
      const { party, snap } = countingParty(row.durationSec, row.offsetMs);
      const phone = await showPartyScreen(`/party/${party.id}/play`, snap);
      const broadcast = await showPartyScreen(`/party/${party.id}/broadcast`, snap);
      const phoneValue = phoneDigit(phone);
      const broadcastValue = broadcastDigit(broadcast);

      if (row.shown > 0) {
        expect(phoneValue).toBe(String(row.shown));
        expect(broadcastValue).toBe(String(row.shown));
        expect(Number(phoneValue)).toBeLessThanOrEqual(row.durationSec);
        expect(Number(broadcastValue)).toBeLessThanOrEqual(row.durationSec);
        continue;
      }

      expect(phoneValue).toBeNull();
      expect(broadcastValue).toBeNull();
      if (row.durationSec > 0) {
        expect(broadcast.textContent).toContain("GO !");
        expect(phone.querySelector('button[aria-label="Buzz"]')).not.toBeNull();
      } else {
        expect(broadcast.textContent).not.toContain("GO !");
        expect(phone.querySelector(".bz-buzz-counting")).toBeNull();
      }
    }
  });
});
