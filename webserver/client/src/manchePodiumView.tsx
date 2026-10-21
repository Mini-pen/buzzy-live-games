import type { JSX } from "react";

import { podiumPhoneFocus, type ManchePodium, type PodiumStep } from "../../src/domain/manchePodium";

function teamPlayerCountLabel(count: number): string {
  return count === 1 ? "1 joueur" : `${count} joueurs`;
}

function StepCard(props: { step: PodiumStep }): JSX.Element {
  const { step } = props;
  return (
    <li className={`bz-podium-step bz-podium-step--r${step.rank}`} data-rank={step.rank}>
      {step.rank === 1 ? (
        <span className="bz-podium-crown" aria-hidden="true">
          ♛
        </span>
      ) : null}
      <span className="bz-podium-place">{step.rankLabel}</span>
      {step.tied ? <span className="bz-podium-tie">Ex æquo</span> : null}
      {step.members.map((member) => (
        <div key={member.id} className="bz-podium-member">
          <span className="bz-podium-initial" aria-hidden="true">
            {member.initial}
          </span>
          <strong className="bz-podium-name">{member.name}</strong>
          {member.teamLabel !== null ? <span className="bz-podium-team">{member.teamLabel}</span> : null}
          {member.memberCount !== null ? (
            // INCERTAIN: Coding Agent, 2026-10-22, nombre de joueurs affiché sous le nom d'équipe d'après la maquette Design UI, à confirmer par Minipen
            <span className="bz-podium-members">{teamPlayerCountLabel(member.memberCount)}</span>
          ) : null}
          <span className="bz-podium-score">{member.scoreLabel}</span>
        </div>
      ))}
    </li>
  );
}

/** * End-of-manche podium. The screen does not scroll; extra names stay in the « + N » line. */
export function ManchePodiumView(props: {
  podium: ManchePodium;
  surface: "broadcast" | "phone";
  playerId?: string | null;
}): JSX.Element {
  const focus =
    props.surface === "phone" && typeof props.playerId === "string"
      ? podiumPhoneFocus(props.podium, props.playerId)
      : null;
  return (
    <section
      className={props.surface === "phone" ? "bz-podium bz-podium--phone" : "bz-podium"}
      aria-label={props.podium.title}
    >
      <header className="bz-podium-head">
        <h1>{props.podium.title}</h1>
        <p>{props.podium.subtitle}</p>
        <p className="bz-podium-wait">En attente de l'animateur</p>
      </header>
      <ol className="bz-podium-steps">
        {props.podium.steps.map((step) => (
          <StepCard key={step.rank} step={step} />
        ))}
      </ol>
      {props.podium.side.length > 0 ? (
        <ol className="bz-podium-side">
          {props.podium.side.map((row) => (
            <li key={row.id}>
              <span>{row.rankLabel}</span>
              <span className="bz-podium-name">{row.name}</span>
              <span>{row.scoreShort}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {props.podium.othersLabel !== null ? <p className="bz-podium-others">{props.podium.othersLabel}</p> : null}
      {focus !== null ? (
        <aside className="bz-podium-you">
          <p className="bz-podium-you-kicker">Votre place</p>
          <p className="bz-podium-you-place">{focus.placeLabel}</p>
          {focus.teamLine !== null ? <p>{focus.teamLine}</p> : null}
          {focus.contributionLine !== null ? <p>{focus.contributionLine}</p> : null}
          {focus.bestPlayerLine !== null ? <p>{focus.bestPlayerLine}</p> : null}
          {focus.neighbors.length > 0 ? (
            <ul>
              {focus.neighbors.map((neighbor) => (
                <li key={`${neighbor.rankLabel}-${neighbor.name}`} className={neighbor.you ? "is-you" : undefined}>
                  <span>{neighbor.rankLabel}</span>
                  <span>{neighbor.name}</span>
                  <span>{neighbor.scoreShort}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}
