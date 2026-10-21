// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoadedBuzzSoundCatalog } from "../games/buzzSoundCatalog.js";
import type { QuizPack } from "../games/pack.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";
import { adminRequests, flushAdmin, releaseAdminScreens, showAdminScreen, socketSink } from "./renderAdminScreen.js";
import { PartyStore } from "./store.js";
import type { PartyPublicSnapshot } from "./types.js";

/**
 * * A numeric setting is sent on blur or Enter, not on each keystroke.
 *   A snapshot that still has the old number must not rewrite the field while it is being typed.
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

function setNativeValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const tracker = (input as HTMLInputElement & { _valueTracker?: { setValue: (next: string) => void } })._valueTracker;
  tracker?.setValue("");
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(async () => {
  await releaseAdminScreens();
  vi.useRealTimers();
});

describe("saisie d'un réglage numérique", () => {
  it("envoie 30 au blur ou à Entrée, et un snapshot ancien ne réécrit pas le champ pendant la frappe", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
    const store = new PartyStore(() => {}, buzzCatalog);
    const party = store.createParty({
      maxPlayers: null,
      maxTeams: null,
      closedAfterStart: false,
      allowRename: true,
      allowTeamChange: true,
    });
    const pack: QuizPack = {
      id: "pack-setting",
      basename: "pack-setting",
      title: "Pack",
      rounds: [{ title: "Manche", questions: [{ prompt: "ENONCE_REGLAGE", choices: ["A", "B"], correctIndex: 0, points: 1 }] }],
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
    store.adminSetNextQuestionCountdownSec(party, 20);
    store.hostLaunchManche(party, party.mancheScript[0]!.id, "normal", true, packs);
    const host = (): PartyPublicSnapshot => partySnapshotWithGame(party, packs, "host");
    const player = (): PartyPublicSnapshot => partySnapshotWithGame(party, packs, "player");
    const stale = host();
    expect(stale.nextQuestionCountdownSec).toBe(20);

    const assigned: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const originalSet = descriptor?.set;
    const originalGet = descriptor?.get;
    if (originalSet !== undefined && originalGet !== undefined) {
      Object.defineProperty(HTMLInputElement.prototype, "value", {
        configurable: true,
        get() {
          return originalGet.call(this);
        },
        set(value: string) {
          const field = this as HTMLInputElement;
          if (field.id === `bz-next-${party.id}`) assigned.push(String(value));
          originalSet.call(this, value);
        },
      });
    }

    try {
      const page = await showAdminScreen(`/party/${party.id}/admin`, host, player, { hostToken: "host-token" });
      for (let i = 0; i < 4 && socketSink.onPatch === null; i += 1) await flushAdmin();
      expect(socketSink.onPatch).not.toBeNull();
      const toggle = page.querySelector<HTMLButtonElement>(".bz-party-settings-toggle");
      await act(async () => {
        toggle?.click();
      });
      const field = page.querySelector<HTMLInputElement>(`#bz-next-${party.id}`);
      expect(field?.value).toBe("20");
      await act(async () => {
        field?.focus();
        if (field) setNativeValue(field, "30");
      });
      expect(field?.value).toBe("30");
      expect(adminRequests.some((request) => request.url.includes("/host/next-question-countdown"))).toBe(false);

      await act(async () => {
        socketSink.onPatch?.(stale);
      });
      expect(field?.value).toBe("30");
      expect(adminRequests.some((request) => request.url.includes("/host/next-question-countdown"))).toBe(false);

      await act(async () => {
        field?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      await flushAdmin();
      const posted = adminRequests.find((request) => request.url.includes("/host/next-question-countdown"));
      expect(posted?.body).toContain('"seconds":30');
      await act(async () => {
        socketSink.onPatch?.(stale);
      });
      expect(field?.value).toBe("30");

      const firstThirty = assigned.indexOf("30");
      const snappedBack = firstThirty >= 0 && assigned.slice(firstThirty + 1).includes("20");
      // * The brief return to the old value after Enter is still an open bug if this is true.
      //   Cause to name if it fails: HostNumberField clears `draft` on blur (App.tsx:3304-3306)
      //   before the server snapshot echoes 30, so the input paints `props.value` again.
      expect(snappedBack).toBe(false);
    } finally {
      if (descriptor !== undefined) Object.defineProperty(HTMLInputElement.prototype, "value", descriptor);
    }
  });
});
