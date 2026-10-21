/** * One line each. Add a phrase by appending a string. */
export const READY_PHASE_TAGLINES = [
  "Chauffe Marcel !",
  "Une question bien cuite pour la table 4, s'il vous plaît !",
  "Attachez vos ceintures, la prochaine question arrive !",
  "Décollage imminent de la prochaine question !",
  "Branchez bien vos neurones !",
  "Échauffez vos doigts, ça va buzzer !",
  "La question sort du four, attention c'est chaud !",
  "Silence dans les rangs, le cerveau démarre…",
  "Rechargement des neurones : 99 %…",
  "On secoue les méninges avant de servir !",
  "Prochaine question en approche, gardez les yeux ouverts !",
  "Les paris sont ouverts, la question arrive !",
  "Mode génie : activation en cours…",
  "Préparez le buzzer, la question est en cuisine !",
  "Respirez… la question arrive au galop !",
  "Tenez-vous prêts, ça va piquer !",
  "La question est dans l'ascenseur, elle arrive !",
  "Petit café pour les neurones, et c'est reparti !",
] as const;

/**
 * * Picks one tagline for the ready phase. The same value is stored on the party
 *   so every screen shows it. Never repeats the previous phrase when another exists.
 */
export function pickReadyPhaseTagline(
  previous: string | null,
  randomUnit: number,
  phrases: readonly string[] = READY_PHASE_TAGLINES,
): string {
  if (phrases.length === 0) return "";
  if (phrases.length === 1) return phrases[0] ?? "";
  const span = phrases.length;
  const unit = Number.isFinite(randomUnit) ? Math.min(0.999999, Math.max(0, randomUnit)) : 0;
  let index = Math.floor(unit * span);
  if (phrases[index] === previous) index = (index + 1) % span;
  return phrases[index] ?? phrases[0] ?? "";
}
