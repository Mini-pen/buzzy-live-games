/** * Tutorial slide definition */
export interface TutorialSlide {
  title: string;
  description: string;
  icon?: string;
}

export interface GameTutorial {
  gameKind: string;
  title: string;
  slides: TutorialSlide[];
}

/** * Pre-made tutorials for each game type (evolution 4.4) */
export const GAME_TUTORIALS: Record<string, GameTutorial> = {
  quiz: {
    gameKind: "quiz",
    title: "Quiz QCM",
    slides: [
      {
        title: "Bienvenue au Quiz !",
        description: "Répondez aux questions à choix multiples en appuyant sur le buzzer après avoir sélectionné votre réponse.",
        icon: "📝",
      },
      {
        title: "Comment jouer ?",
        description: "1. Lisez la question\n2. Choisissez votre réponse (A, B, C, D)\n3. Appuyez sur BUZZ pour valider\n4. Gagnez des points si vous avez raison !",
        icon: "🎯",
      },
    ],
  },
  audio_blind: {
    gameKind: "audio_blind",
    title: "Blind Test Audio",
    slides: [
      {
        title: "Blind Test Musical !",
        description: "Écoutez l'extrait audio et devinez le titre et l'artiste.",
        icon: "🎵",
      },
      {
        title: "Comment jouer ?",
        description: "1. Écoutez l'extrait\n2. Buzzez dès que vous savez\n3. Donnez votre réponse à voix haute\n4. L'animateur valide ou invalide",
        icon: "🎤",
      },
    ],
  },
  progressive_guess: {
    gameKind: "progressive_guess",
    title: "Révélation Progressive",
    slides: [
      {
        title: "Devinez avec des Indices !",
        description: "Des indices visuels sont révélés progressivement. Devinez la réponse le plus tôt possible pour gagner plus de points.",
        icon: "🔍",
      },
      {
        title: "Comment jouer ?",
        description: "1. Regardez les indices qui apparaissent\n2. Buzzez dès que vous pensez savoir\n3. Donnez votre réponse à voix haute\n4. Plus vous buzzez tôt, plus vous gagnez de points !",
        icon: "⭐",
      },
    ],
  },
  image_buzz: {
    gameKind: "image_buzz",
    title: "Buzz sur Image",
    slides: [
      {
        title: "Répondez sur les Images !",
        description: "Une image apparaît à l'écran. Buzzez et répondez à voix haute.",
        icon: "🖼️",
      },
      {
        title: "Comment jouer ?",
        description: "1. Observez l'image\n2. Buzzez quand vous savez la réponse\n3. Donnez votre réponse à voix haute\n4. L'animateur valide et attribue les points",
        icon: "✅",
      },
    ],
  },
  free_buzz: {
    gameKind: "free_buzz",
    title: "Buzz Libre",
    slides: [
      {
        title: "Questions Libres !",
        description: "L'animateur pose des questions. Buzzez pour répondre !",
        icon: "💭",
      },
      {
        title: "Comment jouer ?",
        description: "1. Écoutez la question de l'animateur\n2. Buzzez dès que vous savez\n3. Répondez à voix haute\n4. L'animateur décide des points",
        icon: "🔔",
      },
    ],
  },
  video: {
    gameKind: "video",
    title: "Vidéo",
    slides: [
      {
        title: "Vidéo",
        description: "Profitez de la vidéo !",
        icon: "🎬",
      },
    ],
  },
};
