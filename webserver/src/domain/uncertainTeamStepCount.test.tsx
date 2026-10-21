// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { releaseRenderedScreens, showPartyScreen } from "./renderPartyScreen.js";
import { PartyStore } from "./store.js";

/**
 * * CHOIX INCERTAIN — « 1 joueur » / « 2 joueurs » sous le nom d'équipe sur la marche.
 *   manchePodiumView.tsx affiche `memberCount` (98e9559). En attente de Minipen.
 *
 *   Pour inverser ce fichier seul : passer `SHOW_PLAYER_COUNT_UNDER_THE_TEAM_NAME` à `false`.
 *   Le test attendra alors l'absence de `.bz-podium-members`.
 */

const SHOW_PLAYER_COUNT_UNDER_THE_TEAM_NAME = true;

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

afterEach(async () => {
  await releaseRenderedScreens();
});

describe("CHOIX INCERTAIN — nombre de joueurs sous le nom d'équipe", () => {
  it("écrit 2 joueurs et 1 joueur sur les marches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
    const store = new PartyStore(() => {}, buzzCatalog);
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: 2,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    for (const player of [
      { id: "alice", name: "Alice", score: 8, teamId: 1 },
      { id: "bob", name: "Bob", score: 3, teamId: 1 },
      { id: "chloe", name: "Chloe", score: 5, teamId: 2 },
    ]) {
      party.players.set(player.id, {
        id: player.id,
        displayName: player.name,
        avatarKey: "a.png",
        buzzSoundKey: "good1",
        teamId: player.teamId,
        score: player.score,
        joinedAt: 1,
      });
    }
    const pack: QuizPack = {
      id: "pack-team-count",
      basename: "pack-team-count",
      title: "Pack",
      rounds: [{ title: "Manche", questions: [{ prompt: "Q_EQUIPE", choices: ["A", "B"], correctIndex: 0, points: 1 }] }],
    };
    const packs = new Map<string, QuizPack>([[pack.basename, pack]]);
    store.hostAppendManche(party, {
      kind: "pack_quiz",
      title: pack.title,
      packBasename: pack.basename,
      iframeUrl: null,
      youtubeEmbedUrl: null,
      directVideoUrl: null,
      savedRoundIndex: 0,
      savedQuestionIndex: 0,
      transitionKind: null,
      transitionDurationMs: null,
    });
    store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", true, packs);
    try {
      store.adminAdvanceCue(party, pack);
    } catch (error: unknown) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ROUND_EXHAUSTED") throw error;
    }
    const snap = partySnapshotWithGame(party, packs, "player");
    const phone = await showPartyScreen(`/party/${party.id}/play`, snap, "bob");
    const first = phone.querySelector('[data-rank="1"] .bz-podium-members');
    const second = phone.querySelector('[data-rank="2"] .bz-podium-members');
    if (!SHOW_PLAYER_COUNT_UNDER_THE_TEAM_NAME) {
      expect(first).toBeNull();
      expect(second).toBeNull();
      return;
    }
    expect(first?.textContent).toBe("2 joueurs");
    expect(second?.textContent).toBe("1 joueur");
    expect(phone.querySelector('[data-rank="1"] .bz-podium-name')?.textContent).toBe("Équipe 1");
    expect(phone.querySelector('[data-rank="2"] .bz-podium-name')?.textContent).toBe("Équipe 2");
  });
});
