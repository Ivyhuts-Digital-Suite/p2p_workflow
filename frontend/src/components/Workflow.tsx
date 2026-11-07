import { Link } from 'react-router-dom';
import { useState } from 'react';
import { journeyApi } from '../api/services';
import { navItemsFor } from '../config/navigation';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import type { JourneyStep, JourneyTrack, PendingAt } from '../types';
import { formatMoney } from '../utils/format';
import { Modal } from './overlays';
import { PrChat } from './PrChat';
import { Card, Empty, ErrorBanner } from './ui';

/** Actual Amount + Tax Amount = Total Amount */
export function PriceBreakdown({ actual, tax, total, compact }: { actual?: number; tax?: number; total?: number; compact?: boolean }) {
  return (
    <span className={`price${compact ? ' price-compact' : ''}`}>
      <span title="Actual amount, before tax">{formatMoney(actual)}</span>
      <span className="price-op">+</span>
      <span title="Tax amount">{formatMoney(tax)}</span>
      <span className="price-op">=</span>
      <strong title="Total amount">{formatMoney(total)}</strong>
    </span>
  );
}

/** Says why an action is unavailable and who it is waiting on. */
export function LockBanner({ pendingAt, message }: { pendingAt?: PendingAt | null; message?: string }) {
  const text = message ?? (pendingAt ? `Action locked: Process/Approval pending at ${pendingAt.label}. Please wait until completion.` : null);
  if (!text) return null;
  return (
    <div className="lock" role="status">
      <span aria-hidden="true">🔒</span> {text}
    </div>
  );
}

const STATE_LABEL = { done: 'Done', current: 'Pending', blocked: 'Blocked', locked: 'Not started' };

function Step({ step }: { step: JourneyStep }) {
  return (
    <li className={`journey-step step-${step.state}`} title={`${step.label}: ${step.status}`}>
      <span className="step-dot" aria-hidden="true">
        {step.state === 'done' ? '✓' : step.state === 'locked' ? '🔒' : step.state === 'blocked' ? '!' : '●'}
      </span>
      <span className="step-label">
        {/* One status per step: what is pending, or what was done. A step not reached yet shows just its name. */}
        {step.state === 'locked' ? step.label : step.status}
        <span className="sr-only"> ({STATE_LABEL[step.state]})</span>
        {step.detail && <span className="step-detail">{step.detail}</span>}
      </span>
    </li>
  );
}

/** Splits a track into runs: single steps, and consecutive steps of one stage such as Finance. */
function toStages(steps: JourneyStep[]) {
  const stages: { group?: string; steps: JourneyStep[] }[] = [];
  for (const step of steps) {
    const last = stages[stages.length - 1];
    if (step.group && last?.group === step.group) last.steps.push(step);
    else stages.push({ group: step.group, steps: [step] });
  }
  return stages;
}

/** The page where a step's work is done, for the caller's own pending step. */
function taskPage(step: string, isVendor: boolean): string | null {
  if (step === 'Payment approval') return '#payment-approvals';
  if (['Tax verification', 'Payment release', 'Emergency ratification'].includes(step)) return '/treasury';
  if (step === 'Invoice' || step === 'Invoice verification & 3-way match') return '/invoices';
  if (step === 'Goods receipt & inspection') return '/grn';
  if (step === 'Service sign-off' || step === 'Commissioning sign-off') return '/service-entries';
  if (['PO approval', 'PO issued', 'Vendor acknowledgement', 'Acknowledge PO', 'Closed'].includes(step)) return '/purchase-orders';
  if (step === 'Bid submitted' || step === 'Bidding closed') return isVendor ? '/vendor/rfqs' : '/sourcing';
  if (step === 'RFQ published' || step === 'Emergency PO') return '/requisitions';
  if (['Bidding', 'Technical evaluation', 'Vendor selected'].includes(step)) return '/sourcing';
  if (step === 'PR raised' || step.endsWith(' approval')) return '/requisitions';
  return null;
}

function GoToTask({ step }: { step?: string }) {
  const { user } = useAuth();
  const page = step ? taskPage(step, user?.role === 'VENDOR') : null;
  // Only ever link to a page the user's role can open.
  if (!page || !user || (!page.startsWith('#') && !navItemsFor(user.role).some((item) => item.path === page))) return null;
  if (page.startsWith('#')) {
    return (
      <button type="button" className="btn btn-sm btn-primary" onClick={() => document.getElementById(page.slice(1))?.scrollIntoView({ behavior: 'smooth' })}>
        Go to task
      </button>
    );
  }
  return (
    <Link className="btn btn-sm btn-primary" to={page}>
      Go to task
    </Link>
  );
}

/** Roles that can open a PR, and so take part in its conversation. */
const PR_CHAT_ROLES = ['REQUESTER', 'HOD', 'PROCUREMENT', 'FINANCE', 'ADMIN', 'AUDITOR'];

/** One track: every step from start to finish, the current one highlighted, and who it waits on. */
export function TrackView({ track, withChat = false }: { track: JourneyTrack; withChat?: boolean }) {
  const { user } = useAuth();
  const [chatting, setChatting] = useState(false);
  const canChat = withChat && !!track.prId && !!user && PR_CHAT_ROLES.includes(user.role);
  return (
    <article className={`journey${track.yourAction ? ' journey-mine' : ''}`}>
      <header className="journey-head">
        <span>
          <span className="mono small">{track.reference}</span> <strong>{track.title}</strong>
        </span>
        <span className="journey-message-wrap">
          <span className={`journey-message${track.yourAction ? ' journey-message-mine' : ''}`}>
            {track.yourAction ? `Your action: ${track.steps.find((s) => s.state === 'current')?.label}` : track.message}
          </span>
          <span className="journey-actions">
            {track.yourAction && <GoToTask step={track.steps.find((s) => s.state === 'current')?.label} />}
            {canChat && (
              <button type="button" className="btn btn-sm" onClick={() => setChatting(true)}>
                Start Chat
              </button>
            )}
          </span>
        </span>
      </header>
      {chatting && track.prId && (
        <Modal title={`Conversation: ${track.reference} ${track.title}`} onClose={() => setChatting(false)} wide>
          <PrChat prId={track.prId} prNumber={track.reference} />
        </Modal>
      )}
      <ol className="journey-steps">
        {toStages(track.steps).map((stage, index) =>
          stage.group ? (
            <li key={index} className="journey-stage">
              <span className="journey-stage-label">{stage.group}</span>
              <ol className="journey-stage-steps">
                {stage.steps.map((step) => (
                  <Step key={step.label} step={step} />
                ))}
              </ol>
            </li>
          ) : (
            <Step key={index} step={stage.steps[0]} />
          ),
        )}
      </ol>
    </article>
  );
}

/** Each open piece of the caller's work, step by step, and who it is waiting on. */
export function JourneyPath() {
  const { data, error } = useApi(() => journeyApi.mine());

  return (
    <Card title="Your journey">
      <ErrorBanner message={error} />
      {data && !data.tracks.length && <Empty>Nothing in progress right now.</Empty>}
      {data && data.yourActions > 0 && (
        <p className="journey-summary">
          <strong>{data.yourActions}</strong> {data.yourActions === 1 ? 'item is' : 'items are'} waiting on you.
        </p>
      )}
      <div className="journeys">
        {data?.tracks.map((track) => (
          <TrackView key={track.id} track={track} withChat />
        ))}
      </div>
    </Card>
  );
}
