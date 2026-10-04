import { describe, expect, it, beforeEach } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { PartyStore } from "./store.js";
import type { MancheCatalogItem, Party, PartyNotifyMeta } from "./types.js";

describe("PartyStore - Tutorial System (evolution 4.4)", () => {
  let store: PartyStore;
  let party: Party;
  let packs: Map<string, QuizPack>;
  let notifications: Array<{ partyId: string; meta?: PartyNotifyMeta | PartyNotifyMeta[] }>;

  const mockBuzzCatalog: LoadedBuzzSoundCatalog = {
    sounds: [
      {
        key: "buzz1",
        label: "Buzzer",
        file: "buzz/buzz1.mp3",
        pool: "buzzer",
      },
      {
        key: "good1",
        label: "Good Sound",
        file: "good/sound1.mp3",
        pool: "good",
      },
      {
        key: "bad1",
        label: "Bad Sound",
        file: "bad/sound1.mp3",
        pool: "bad",
      },
    ],
    byKey: new Map([
      [
        "buzz1",
        {
          key: "buzz1",
          label: "Buzzer",
          file: "buzz/buzz1.mp3",
          pool: "buzzer",
        },
      ],
      [
        "good1",
        {
          key: "good1",
          label: "Good Sound",
          file: "good/sound1.mp3",
          pool: "good",
        },
      ],
      [
        "bad1",
        {
          key: "bad1",
          label: "Bad Sound",
          file: "bad/sound1.mp3",
          pool: "bad",
        },
      ],
    ]),
    defaultBuzzerKey: "buzz1",
  };

  beforeEach(() => {
    notifications = [];
    store = new PartyStore((partyId, _party, meta) => {
      notifications.push({ partyId, meta });
    }, mockBuzzCatalog);
    party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });

    packs = new Map();
  });

  function createQuizPack(id: string): QuizPack {
    return {
      id,
      title: `Pack ${id}`,
      rounds: [
        {
          kind: "quiz",
          title: "Quiz Round",
          questions: [
            {
              prompt: "Question 1",
              choices: ["A", "B", "C"],
              correctIndex: 0,
              points: 10,
            },
          ],
        },
      ],
    };
  }

  function createAudioBlindPack(id: string): QuizPack {
    return {
      id,
      title: `Pack ${id}`,
      rounds: [
        {
          kind: "audio_blind",
          title: "Audio Blind Test",
          tracks: [
            {
              audioUrl: "/audio/track1.mp3",
              revealTitle: "Title 1",
              revealArtist: "Artist 1",
            },
          ],
        },
      ],
    };
  }

  function createProgressiveGuessPack(id: string): QuizPack {
    return {
      id,
      title: `Pack ${id}`,
      rounds: [
        {
          kind: "progressive_guess",
          title: "Progressive Reveal",
          items: [
            {
              answer: "Answer 1",
              clues: [
                {
                  imageUrl: "/img/clue1.jpg",
                  points: 5,
                },
              ],
              revealImageUrl: "/img/reveal1.jpg",
            },
          ],
        },
      ],
    };
  }

  function createImageBuzzPack(id: string): QuizPack {
    return {
      id,
      title: `Pack ${id}`,
      rounds: [
        {
          kind: "image_buzz",
          title: "Image Buzz",
          slides: [
            {
              imageUrl: "/img/slide1.jpg",
              points: 5,
            },
          ],
        },
      ],
    };
  }

  function createFreeBuzzPack(id: string): QuizPack {
    return {
      id,
      title: `Pack ${id}`,
      rounds: [
        {
          kind: "free_buzz",
          title: "Free Buzz",
          plannedQuestionCount: null,
        },
      ],
    };
  }

  function createVideoPack(id: string): QuizPack {
    return {
      id,
      title: `Pack ${id}`,
      rounds: [
        {
          title: "Video Round",
          videoUrl: "/videos/video1.mp4",
        },
      ],
    };
  }

  function addManche(
    store: PartyStore,
    party: Party,
    packBasename: string,
    title: string,
  ): void {
    const item: Omit<MancheCatalogItem, "id" | "launchMode"> = {
      kind: "pack_quiz",
      title,
      packBasename,
      iframeUrl: null,
      youtubeEmbedUrl: null,
      directVideoUrl: null,
      savedRoundIndex: 0,
      savedQuestionIndex: 0,
      transitionKind: null,
      transitionDurationMs: null,
    };
    store.hostAppendManche(party, item);
  }

  describe("Tutorial shown on first launch of each game kind", () => {
    it("shows tutorial for quiz on first launch in normal mode", () => {
      const quizPack = createQuizPack("quiz-pack");
      packs.set("quiz-pack", quizPack);
      addManche(store, party, "quiz-pack", "Quiz Manche");

      notifications = [];
      const result = store.hostLaunchManche(
        party,
        party.mancheScript[0]!.id,
        "normal",
        false,
        packs,
      );

      expect(result.shouldShowTutorial).toBe(true);
      expect(result.gameKind).toBe("quiz");
      expect(party.seenGameKinds.has("quiz")).toBe(true);

      const tutorialNotif = notifications.find((n) => {
        const meta = Array.isArray(n.meta) ? n.meta : [n.meta];
        return meta.some((m) => m?.kind === "tutorial");
      });
      expect(tutorialNotif).toBeDefined();
      const meta = tutorialNotif!.meta;
      const tutorialMeta = (Array.isArray(meta) ? meta : [meta]).find(
        (m) => m?.kind === "tutorial",
      );
      expect(tutorialMeta).toEqual({
        kind: "tutorial",
        gameKind: "quiz",
        canSkip: true,
      });
    });

    it("shows tutorial for audio_blind on first launch", () => {
      const audioBlindPack = createAudioBlindPack("audio-blind-pack");
      packs.set("audio-blind-pack", audioBlindPack);
      addManche(store, party, "audio-blind-pack", "Audio Blind Manche");

      notifications = [];
      const result = store.hostLaunchManche(
        party,
        party.mancheScript[0]!.id,
        "normal",
        false,
        packs,
      );

      expect(result.shouldShowTutorial).toBe(true);
      expect(result.gameKind).toBe("audio_blind");
      expect(party.seenGameKinds.has("audio_blind")).toBe(true);
    });

    it("shows tutorial for progressive_guess on first launch", () => {
      const progressivePack = createProgressiveGuessPack("progressive-pack");
      packs.set("progressive-pack", progressivePack);
      addManche(store, party, "progressive-pack", "Progressive Manche");

      notifications = [];
      const result = store.hostLaunchManche(
        party,
        party.mancheScript[0]!.id,
        "normal",
        false,
        packs,
      );

      expect(result.shouldShowTutorial).toBe(true);
      expect(result.gameKind).toBe("progressive_guess");
      expect(party.seenGameKinds.has("progressive_guess")).toBe(true);
    });

    it("shows tutorial for image_buzz on first launch", () => {
      const imageBuzzPack = createImageBuzzPack("image-buzz-pack");
      packs.set("image-buzz-pack", imageBuzzPack);
      addManche(store, party, "image-buzz-pack", "Image Buzz Manche");

      notifications = [];
      const result = store.hostLaunchManche(
        party,
        party.mancheScript[0]!.id,
        "normal",
        false,
        packs,
      );

      expect(result.shouldShowTutorial).toBe(true);
      expect(result.gameKind).toBe("image_buzz");
      expect(party.seenGameKinds.has("image_buzz")).toBe(true);
    });

    it("shows tutorial for free_buzz on first launch", () => {
      const freeBuzzPack = createFreeBuzzPack("free-buzz-pack");
      packs.set("free-buzz-pack", freeBuzzPack);
      addManche(store, party, "free-buzz-pack", "Free Buzz Manche");

      notifications = [];
      const result = store.hostLaunchManche(
        party,
        party.mancheScript[0]!.id,
        "normal",
        false,
        packs,
      );

      expect(result.shouldShowTutorial).toBe(true);
      expect(result.gameKind).toBe("free_buzz");
      expect(party.seenGameKinds.has("free_buzz")).toBe(true);
    });

    it("shows tutorial for video on first launch", () => {
      const videoPack = createVideoPack("video-pack");
      packs.set("video-pack", videoPack);
      addManche(store, party, "video-pack", "Video Manche");

      notifications = [];
      const result = store.hostLaunchManche(
        party,
        party.mancheScript[0]!.id,
        "normal",
        false,
        packs,
      );

      expect(result.shouldShowTutorial).toBe(true);
      expect(result.gameKind).toBe("video");
      expect(party.seenGameKinds.has("video")).toBe(true);
    });
  });

  describe("Tutorial not shown on second launch of same kind", () => {
    it("does not show tutorial for quiz on second launch", () => {
      const quizPack1 = createQuizPack("quiz-pack-1");
      const quizPack2 = createQuizPack("quiz-pack-2");
      packs.set("quiz-pack-1", quizPack1);
      packs.set("quiz-pack-2", quizPack2);
      addManche(store, party, "quiz-pack-1", "First Quiz");
      addManche(store, party, "quiz-pack-2", "Second Quiz");

      store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", false, packs);

      expect(party.seenGameKinds.has("quiz")).toBe(true);

      store.adminPauseToLobby(party);

      notifications = [];
      const result = store.hostLaunchManche(
        party,
        party.mancheScript[0]!.id,
        "normal",
        false,
        packs,
      );

      expect(result.shouldShowTutorial).toBe(false);
      expect(result.gameKind).toBe("quiz");

      const tutorialNotif = notifications.find((n) => {
        const meta = Array.isArray(n.meta) ? n.meta : [n.meta];
        return meta.some((m) => m?.kind === "tutorial");
      });
      expect(tutorialNotif).toBeUndefined();
    });
  });

  describe("Tutorial shown for different kinds", () => {
    it("shows tutorial for audio_blind after quiz was already seen", () => {
      const quizPack = createQuizPack("quiz-pack");
      const audioBlindPack = createAudioBlindPack("audio-blind-pack");
      packs.set("quiz-pack", quizPack);
      packs.set("audio-blind-pack", audioBlindPack);
      addManche(store, party, "quiz-pack", "Quiz");
      addManche(store, party, "audio-blind-pack", "Audio Blind");

      const quizMancheId = party.mancheScript[0]!.id;
      store.hostLaunchManche(party, quizMancheId, "normal", false, packs);

      expect(party.seenGameKinds.has("quiz")).toBe(true);
      expect(party.seenGameKinds.has("audio_blind")).toBe(false);

      store.adminPauseToLobby(party);

      const audioBlindMancheId = party.mancheScript.find(
        (m) => m.packBasename === "audio-blind-pack",
      )!.id;

      notifications = [];
      const result = store.hostLaunchManche(party, audioBlindMancheId, "normal", false, packs);

      expect(result.shouldShowTutorial).toBe(true);
      expect(result.gameKind).toBe("audio_blind");
      expect(party.seenGameKinds.has("audio_blind")).toBe(true);

      const tutorialNotif = notifications.find((n) => {
        const meta = Array.isArray(n.meta) ? n.meta : [n.meta];
        return meta.some((m) => m?.kind === "tutorial");
      });
      expect(tutorialNotif).toBeDefined();
    });
  });

  describe("Tutorial not shown in autonomous mode", () => {
    it("shows tutorial in autonomous mode on first launch (autonomous does not skip tutorial)", () => {
      const quizPack = createQuizPack("quiz-pack");
      packs.set("quiz-pack", quizPack);
      addManche(store, party, "quiz-pack", "Quiz Manche");

      notifications = [];
      const result = store.hostLaunchManche(
        party,
        party.mancheScript[0]!.id,
        "autonomous",
        false,
        packs,
      );

      expect(result.shouldShowTutorial).toBe(true);
      expect(result.gameKind).toBe("quiz");
      expect(party.seenGameKinds.has("quiz")).toBe(true);

      const tutorialNotif = notifications.find((n) => {
        const meta = Array.isArray(n.meta) ? n.meta : [n.meta];
        return meta.some((m) => m?.kind === "tutorial");
      });
      expect(tutorialNotif).toBeDefined();
    });
  });

  describe("Skip intro flag marks kind as seen", () => {
    it("marks kind as seen when skipIntro is true", () => {
      const quizPack = createQuizPack("quiz-pack");
      packs.set("quiz-pack", quizPack);
      addManche(store, party, "quiz-pack", "Quiz Manche");

      notifications = [];
      const result = store.hostLaunchManche(
        party,
        party.mancheScript[0]!.id,
        "normal",
        true,
        packs,
      );

      expect(result.shouldShowTutorial).toBe(false);
      expect(result.gameKind).toBe("quiz");
      expect(party.seenGameKinds.has("quiz")).toBe(false);

      const tutorialNotif = notifications.find((n) => {
        const meta = Array.isArray(n.meta) ? n.meta : [n.meta];
        return meta.some((m) => m?.kind === "tutorial");
      });
      expect(tutorialNotif).toBeUndefined();
    });
  });

  describe("Launch mode stored on manche", () => {
    it("stores normal launch mode on manche item", () => {
      const quizPack = createQuizPack("quiz-pack");
      packs.set("quiz-pack", quizPack);
      addManche(store, party, "quiz-pack", "Quiz Manche");

      const mancheId = party.mancheScript[0]!.id;
      store.hostLaunchManche(party, mancheId, "normal", false, packs);

      const manche = party.mancheScript.find((m) => m.id === mancheId);
      expect(manche).toBeDefined();
      expect(manche!.launchMode).toBe("normal");
    });

    it("stores autonomous launch mode on manche item", () => {
      const quizPack = createQuizPack("quiz-pack");
      packs.set("quiz-pack", quizPack);
      addManche(store, party, "quiz-pack", "Quiz Manche");

      const mancheId = party.mancheScript[0]!.id;
      store.hostLaunchManche(party, mancheId, "autonomous", false, packs);

      const manche = party.mancheScript.find((m) => m.id === mancheId);
      expect(manche).toBeDefined();
      expect(manche!.launchMode).toBe("autonomous");
    });
  });

  describe("seenGameKinds tracking", () => {
    it("initializes seenGameKinds as empty set", () => {
      expect(party.seenGameKinds).toBeDefined();
      expect(party.seenGameKinds.size).toBe(0);
    });

    it("adds kind to seenGameKinds only when tutorial is shown", () => {
      const quizPack = createQuizPack("quiz-pack");
      packs.set("quiz-pack", quizPack);
      addManche(store, party, "quiz-pack", "Quiz Manche");

      expect(party.seenGameKinds.has("quiz")).toBe(false);

      store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", false, packs);

      expect(party.seenGameKinds.has("quiz")).toBe(true);
    });

    it("adds kind to seenGameKinds in autonomous mode when tutorial is shown", () => {
      const quizPack = createQuizPack("quiz-pack");
      packs.set("quiz-pack", quizPack);
      addManche(store, party, "quiz-pack", "Quiz Manche");

      store.hostLaunchManche(party, party.mancheScript[0]!.id, "autonomous", false, packs);

      expect(party.seenGameKinds.has("quiz")).toBe(true);
    });

    it("does not add kind to seenGameKinds when skipIntro is true", () => {
      const quizPack = createQuizPack("quiz-pack");
      packs.set("quiz-pack", quizPack);
      addManche(store, party, "quiz-pack", "Quiz Manche");

      store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", true, packs);

      expect(party.seenGameKinds.has("quiz")).toBe(false);
    });

    it("accumulates multiple game kinds in seenGameKinds", () => {
      const quizPack = createQuizPack("quiz-pack");
      const audioBlindPack = createAudioBlindPack("audio-blind-pack");
      packs.set("quiz-pack", quizPack);
      packs.set("audio-blind-pack", audioBlindPack);
      addManche(store, party, "quiz-pack", "Quiz");
      addManche(store, party, "audio-blind-pack", "Audio Blind");

      const quizMancheId = party.mancheScript[0]!.id;
      store.hostLaunchManche(party, quizMancheId, "normal", false, packs);

      expect(party.seenGameKinds.has("quiz")).toBe(true);
      expect(party.seenGameKinds.size).toBe(1);

      store.adminPauseToLobby(party);

      const audioBlindMancheId = party.mancheScript.find(
        (m) => m.packBasename === "audio-blind-pack",
      )!.id;
      store.hostLaunchManche(party, audioBlindMancheId, "normal", false, packs);

      expect(party.seenGameKinds.has("quiz")).toBe(true);
      expect(party.seenGameKinds.has("audio_blind")).toBe(true);
      expect(party.seenGameKinds.size).toBe(2);
    });
  });
});
