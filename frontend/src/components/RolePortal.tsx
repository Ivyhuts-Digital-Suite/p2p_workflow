import { ReactNode } from 'react';
import { RoleCardConfig, ROLE_CARDS } from '../config/roles';

export function RoleCards({
  selected,
  onSelect,
  note,
  isDisabled,
}: {
  selected: string | null;
  onSelect: (card: RoleCardConfig) => void;
  /** Optional status line under a card, e.g. that its master account already exists */
  note?: (card: RoleCardConfig) => string | undefined;
  isDisabled?: (card: RoleCardConfig) => boolean;
}) {
  return (
    <div className="role-cards" role="radiogroup" aria-label="Select your role">
      {ROLE_CARDS.map((card) => (
        <button
          type="button"
          key={card.key}
          role="radio"
          aria-checked={selected === card.key}
          className={`role-card${selected === card.key ? ' role-card-selected' : ''}`}
          disabled={isDisabled?.(card)}
          onClick={() => onSelect(card)}
        >
          <span className="role-card-short">{card.shortName}</span>
          <span className="role-card-full">{card.fullName}</span>
          {note?.(card) && <span className="role-card-note">{note(card)}</span>}
        </button>
      ))}
    </div>
  );
}

function QuickReferenceGuide({ selected }: { selected: string | null }) {
  return (
    <aside className="card guide" aria-label="Quick reference guide">
      <h2>Quick Reference Guide</h2>
      <p className="muted small">What each role does</p>
      <dl>
        {ROLE_CARDS.map((card) => (
          <div key={card.key} className={selected === card.key ? 'guide-row guide-row-selected' : 'guide-row'}>
            <dt>{card.fullName}</dt>
            <dd>{card.guide}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/** Shared login / sign-up layout: the portal form beside the quick reference guide. */
export function PortalLayout({ selected, children }: { selected: string | null; children: ReactNode }) {
  return (
    <div className="login">
      <div className="portal">
        <div className="card portal-main">{children}</div>
        <QuickReferenceGuide selected={selected} />
      </div>
    </div>
  );
}
