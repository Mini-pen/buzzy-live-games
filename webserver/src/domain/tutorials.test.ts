import { describe, it, expect } from "vitest";
import { GAME_TUTORIALS } from "./tutorials.js";

describe("GAME_TUTORIALS", () => {
  it("provides tutorials for exactly six game kinds", () => {
    const kinds = Object.keys(GAME_TUTORIALS);
    expect(kinds).toHaveLength(6);
    expect(kinds).toContain("quiz");
    expect(kinds).toContain("audio_blind");
    expect(kinds).toContain("progressive_guess");
    expect(kinds).toContain("image_buzz");
    expect(kinds).toContain("free_buzz");
    expect(kinds).toContain("video");
  });

  it("quiz tutorial has real content with two slides", () => {
    const tutorial = GAME_TUTORIALS.quiz;
    expect(tutorial).toBeDefined();
    expect(tutorial.gameKind).toBe("quiz");
    expect(tutorial.title).toBe("Quiz QCM");
    expect(tutorial.slides).toHaveLength(2);
    expect(tutorial.slides[0]).toEqual({
      title: "Bienvenue au Quiz !",
      description:
        "Répondez aux questions à choix multiples en appuyant sur le buzzer après avoir sélectionné votre réponse.",
      icon: "📝",
    });
    expect(tutorial.slides[1]).toEqual({
      title: "Comment jouer ?",
      description:
        "1. Lisez la question\n2. Choisissez votre réponse (A, B, C, D)\n3. Appuyez sur BUZZ pour valider\n4. Gagnez des points si vous avez raison !",
      icon: "🎯",
    });
  });

  it("audio_blind tutorial has real content with two slides", () => {
    const tutorial = GAME_TUTORIALS.audio_blind;
    expect(tutorial).toBeDefined();
    expect(tutorial.gameKind).toBe("audio_blind");
    expect(tutorial.title).toBe("Blind Test Audio");
    expect(tutorial.slides).toHaveLength(2);
    expect(tutorial.slides[0]).toEqual({
      title: "Blind Test Musical !",
      description: "Écoutez l'extrait audio et devinez le titre et l'artiste.",
      icon: "🎵",
    });
    expect(tutorial.slides[1]).toEqual({
      title: "Comment jouer ?",
      description:
        "1. Écoutez l'extrait\n2. Buzzez dès que vous savez\n3. Donnez votre réponse à voix haute\n4. L'animateur valide ou invalide",
      icon: "🎤",
    });
  });

  it("progressive_guess tutorial has real content with two slides", () => {
    const tutorial = GAME_TUTORIALS.progressive_guess;
    expect(tutorial).toBeDefined();
    expect(tutorial.gameKind).toBe("progressive_guess");
    expect(tutorial.title).toBe("Révélation Progressive");
    expect(tutorial.slides).toHaveLength(2);
    expect(tutorial.slides[0]).toEqual({
      title: "Devinez avec des Indices !",
      description:
        "Des indices visuels sont révélés progressivement. Devinez la réponse le plus tôt possible pour gagner plus de points.",
      icon: "🔍",
    });
    expect(tutorial.slides[1]).toEqual({
      title: "Comment jouer ?",
      description:
        "1. Regardez les indices qui apparaissent\n2. Buzzez dès que vous pensez savoir\n3. Donnez votre réponse à voix haute\n4. Plus vous buzzez tôt, plus vous gagnez de points !",
      icon: "⭐",
    });
  });

  it("image_buzz tutorial has real content with two slides", () => {
    const tutorial = GAME_TUTORIALS.image_buzz;
    expect(tutorial).toBeDefined();
    expect(tutorial.gameKind).toBe("image_buzz");
    expect(tutorial.title).toBe("Buzz sur Image");
    expect(tutorial.slides).toHaveLength(2);
    expect(tutorial.slides[0]).toEqual({
      title: "Répondez sur les Images !",
      description: "Une image apparaît à l'écran. Buzzez et répondez à voix haute.",
      icon: "🖼️",
    });
    expect(tutorial.slides[1]).toEqual({
      title: "Comment jouer ?",
      description:
        "1. Observez l'image\n2. Buzzez quand vous savez la réponse\n3. Donnez votre réponse à voix haute\n4. L'animateur valide et attribue les points",
      icon: "✅",
    });
  });

  it("free_buzz tutorial has real content with two slides", () => {
    const tutorial = GAME_TUTORIALS.free_buzz;
    expect(tutorial).toBeDefined();
    expect(tutorial.gameKind).toBe("free_buzz");
    expect(tutorial.title).toBe("Buzz Libre");
    expect(tutorial.slides).toHaveLength(2);
    expect(tutorial.slides[0]).toEqual({
      title: "Questions Libres !",
      description: "L'animateur pose des questions. Buzzez pour répondre !",
      icon: "💭",
    });
    expect(tutorial.slides[1]).toEqual({
      title: "Comment jouer ?",
      description:
        "1. Écoutez la question de l'animateur\n2. Buzzez dès que vous savez\n3. Répondez à voix haute\n4. L'animateur décide des points",
      icon: "🔔",
    });
  });

  it("video tutorial has real content with one slide", () => {
    const tutorial = GAME_TUTORIALS.video;
    expect(tutorial).toBeDefined();
    expect(tutorial.gameKind).toBe("video");
    expect(tutorial.title).toBe("Vidéo");
    expect(tutorial.slides).toHaveLength(1);
    expect(tutorial.slides[0]).toEqual({
      title: "Vidéo",
      description: "Profitez de la vidéo !",
      icon: "🎬",
    });
  });
});
