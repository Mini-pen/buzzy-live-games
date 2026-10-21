// @vitest-environment happy-dom
import { act, useState, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuestionEditor } from "../../client/src/questionEditor";
import { PlayFrame } from "../../client/src/questionSurface";
import { useFrozenSvh } from "../../client/src/stableViewport";
import type { QuizPack } from "../games/pack.js";
import { QUESTION_PROMPT_MAX_GRAPHEMES } from "./quizTextLimits.js";

/**
 * * Screen structure that happy-dom can see. A real phone measurement stays a Playwright todo.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

function packWithPrompt(prompt: string): QuizPack {
  return {
    id: "editor",
    title: "Éditeur",
    version: 1,
    rounds: [
      {
        id: "quiz",
        title: "Quiz",
        questions: [
          {
            id: "q1",
            prompt,
            choices: ["Oui", "Non"],
            correctIndex: 0,
            points: 1,
          },
        ],
      },
    ],
  };
}

function mount(node: JSX.Element): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(node);
  });
  return container;
}

function frame(tagline: string | null, choices: string[]): JSX.Element {
  return (
    <PlayFrame
      mode="live"
      kicker="Question 1 / 2"
      prompt="ENONCE_VISIBLE"
      choices={choices}
      tagline={tagline}
      showResult={tagline === null}
      correctIndex={0}
      selectedIndex={1}
      counts={choices.map(() => (tagline === null ? 1 : 0))}
      interactive={false}
      header={<span>buzzy</span>}
      buzzer={<button type="button">Buzz</button>}
    />
  );
}

function EditorHarness(props: { prompt: string }): JSX.Element {
  const [pack, setPack] = useState(() => packWithPrompt(props.prompt));
  return <QuestionEditor pack={pack} saving={false} notices={[]} onPack={setPack} onSave={() => undefined} />;
}

function FrozenProbe(): null {
  useFrozenSvh(true);
  return null;
}

function setControlValue(control: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.replaceChildren();
  document.documentElement.style.removeProperty("--bz-stable-vh");
  vi.restoreAllMocks();
});

describe("player question slot", () => {
  it("puts the ready phrase in the question slot and keeps the buzzer in its own slot", () => {
    const quiz = mount(frame(null, ["Un", "Deux", "Trois"]));
    const quizRest = quiz.querySelector(".bz-play-rest");
    expect(quizRest?.children[0]?.classList.contains("bz-qna")).toBe(true);
    expect(quizRest?.children[0]?.classList.contains("bz-ready-hold")).toBe(false);
    expect(quizRest?.children[1]?.classList.contains("bz-buzz-slot")).toBe(true);
    expect(quiz.querySelector(".bz-buzz-slot button")?.textContent).toBe("Buzz");
    expect(quiz.querySelectorAll(".bz-choice-votes").length).toBe(3);
    for (const votes of quiz.querySelectorAll(".bz-choice-votes")) {
      expect(votes.textContent).toBe("1 (33%)");
    }
    expect(quiz.querySelectorAll(".bz-choice--correct").length).toBe(1);
    expect(quiz.querySelectorAll(".bz-choice--selected").length).toBe(1);

    const ready = mount(frame("Phrase commune", ["Un", "Deux"]));
    const readyRest = ready.querySelector(".bz-play-rest");
    const zone = readyRest?.children[0];
    expect(zone?.classList.contains("bz-qna")).toBe(true);
    expect(zone?.classList.contains("bz-ready-hold")).toBe(true);
    expect(zone?.textContent).toContain("Phrase commune");
    expect(zone?.querySelector(".bz-qna-answers, .bz-choice")).toBeNull();
    expect(readyRest?.children[1]?.classList.contains("bz-buzz-slot")).toBe(true);
    expect(ready.textContent).not.toContain("ENONCE_VISIBLE");
  });

  it("shows 0 (0%) on every answer when nobody has voted", () => {
    const container = mount(
      <PlayFrame
        mode="live"
        kicker="Question 1 / 1"
        prompt="Personne ?"
        choices={["Un", "Deux"]}
        showResult
        correctIndex={0}
        selectedIndex={null}
        counts={[0, 0]}
        interactive={false}
        header={<span>buzzy</span>}
        buzzer={<button type="button">Buzz</button>}
      />,
    );
    const votes = [...container.querySelectorAll(".bz-choice-votes")].map((node) => node.textContent);
    expect(votes).toEqual(["0 (0%)", "0 (0%)"]);
  });
});

describe("stable screen height", () => {
  it("measures once, ignores a resize, and measures again on rotation", () => {
    const box = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 640,
      width: 0,
      height: 640,
      toJSON: () => ({}),
    });
    mount(<FrozenProbe />);
    expect(document.documentElement.style.getPropertyValue("--bz-stable-vh")).toBe("640px");
    const callsAfterMount = box.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(box.mock.calls.length).toBe(callsAfterMount);
    expect(document.documentElement.style.getPropertyValue("--bz-stable-vh")).toBe("640px");

    box.mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 800,
      width: 0,
      height: 800,
      toJSON: () => ({}),
    });
    act(() => {
      window.dispatchEvent(new Event("orientationchange"));
    });
    expect(document.documentElement.style.getPropertyValue("--bz-stable-vh")).toBe("800px");
  });
});

describe("question editor counter", () => {
  it("shows 128 / 140 in orange and 141 / 140 in red", async () => {
    const container = mount(<EditorHarness prompt={"a".repeat(128)} />);
    await act(async () => {
      await Promise.resolve();
    });
    const promptField = container.querySelector(".bz-limit-field");
    const counter = promptField?.querySelector(".bz-limit-count");
    expect(counter?.textContent).toBe(`128 / ${QUESTION_PROMPT_MAX_GRAPHEMES}`);
    expect(counter?.classList.contains("bz-limit-count--warn")).toBe(true);

    const area = container.querySelector("textarea");
    expect(area).not.toBeNull();
    await act(async () => {
      setControlValue(area as HTMLTextAreaElement, "é".repeat(141));
    });
    const over = container.querySelector(".bz-limit-field .bz-limit-count");
    expect(over?.textContent).toBe(`141 / ${QUESTION_PROMPT_MAX_GRAPHEMES}`);
    expect(over?.classList.contains("bz-limit-count--over")).toBe(true);
  });

  it("keeps Enregistrer disabled while a field is past the character guardrail", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(220);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(80);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(16);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(11);
    const container = mount(<EditorHarness prompt="Oui" />);
    await act(async () => {
      await Promise.resolve();
    });
    const save = (): HTMLButtonElement | undefined =>
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Enregistrer");
    const block = (): string => container.querySelector(".bz-editor-save-block")?.textContent ?? "";

    expect(save()?.disabled).toBe(false);
    expect(block()).toBe("");

    const area = container.querySelector("textarea");
    await act(async () => {
      setControlValue(area as HTMLTextAreaElement, "é".repeat(141));
    });
    expect(save()?.disabled).toBe(true);
    expect(block()).toContain("dépasse 140 caractères");
  });

  it("keeps Enregistrer disabled when the preview says the prompt does not fit", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(220);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(80);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(16);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(11);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(10_000);
    const container = mount(<EditorHarness prompt="Oui" />);
    await act(async () => {
      await Promise.resolve();
    });
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Enregistrer");
    expect(save?.disabled).toBe(true);
    expect(container.querySelector(".bz-editor-save-block")?.textContent).toContain("ne tient pas dans l'aperçu");
  });
});

describe("layout left to a real browser", () => {
  it.todo("Playwright : le buzzer ne change pas de position quand le texte ou le nombre de réponses change");
  it.todo(
    "Playwright : le bloc « Prêt ? » a la même hauteur en pixels que la zone question et réponses, sur le joueur et la diffusion",
  );
  it.todo(
    "Playwright : l'éditeur refuse d'enregistrer un texte qui ne tient pas dans l'aperçu à la police minimale",
  );
});
