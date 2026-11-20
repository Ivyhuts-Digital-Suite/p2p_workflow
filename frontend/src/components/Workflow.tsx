import { Link } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { chatApi, journeyApi } from '../api/services';
import { navItemsFor } from '../config/navigation';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import type { ChatUnread, JourneyStep, JourneyTrack, PendingAt } from '../types';
import { formatMoney } from '../utils/format';
import { Modal } from './overlays';
import { CHAT_READ_EVENT, PrChat, VendorChat } from './PrChat';
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
  if (['PO generated', 'PO received', 'Closed'].includes(step)) return '/purchase-orders';
  if (step === 'Bid submitted' || step === 'Bidding closed') return isVendor ? '/vendor/rfqs' : '/sourcing';
  if (step === 'RFQ published' || step === 'Emergency PO') return '/requisitions';
  if (['Bidding', 'Vendor selected'].includes(step)) return '/sourcing';
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

/** Roles that take part in a PR's conversation. A vendor joins once their bid is selected (the server sends prId then). */
const PR_CHAT_ROLES = ['REQUESTER', 'HOD', 'PROCUREMENT', 'FINANCE', 'STORE', 'ADMIN', 'AUDITOR'];
/** Roles that talk to vendors on an RFQ (the Auditor reads only). */
const VENDOR_THREAD_ROLES = ['PROCUREMENT', 'ADMIN', 'AUDITOR'];

/** The conversations one card offers this user. */
function cardThreads(track: JourneyTrack, role?: string) {
  if (role === 'VENDOR') return { pr: !!track.prId, vendors: false, own: !!track.rfqId };
  return { pr: !!track.prId && !!role && PR_CHAT_ROLES.includes(role), vendors: !!track.rfqId && !!role && VENDOR_THREAD_ROLES.includes(role), own: false };
}

/** The user's unread messages on one card: its PR conversation, plus the vendor conversations on its RFQ. */
export function cardUnread(track: JourneyTrack, unread: ChatUnread | null | undefined, role?: string) {
  if (!unread) return 0;
  const threads = cardThreads(track, role);
  return (threads.pr && track.prId ? unread.prs[track.prId] ?? 0 : 0) + ((threads.vendors || threads.own) && track.rfqId ? unread.rfqs[track.rfqId] ?? 0 : 0);
}

/** On a staff member's card: the awarded vendor reads the PR conversation once the PO is issued. */
/** The selected vendor reads the PR/PO conversation from the moment they are selected. */
const vendorJoined = (track: JourneyTrack) => track.steps.some((s) => s.label === 'Vendor selected' && s.state === 'done');

/** The chat icon on a journey card, with this user's unread count for that card's conversations. */
function ChatButton({ count, onClick, subject }: { count: number; onClick: () => void; subject: string }) {
  const label = `Chat on ${subject}: ${count ? `${count} unread` : 'no unread messages'}`;
  return (
    <button type="button" className="chat-icon" onClick={onClick} aria-label={label} title={label}>
      <span aria-hidden="true">💬</span>
      {count > 0 && (
        <span className="chat-badge" aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

/**
 * The conversations behind one card. Staff get the PR's internal conversation; Procurement, Admin and the
 * Auditor also get a tab per vendor on the card's RFQ. A vendor gets only their own conversation with the buyer.
 */
function CardChat({ track }: { track: JourneyTrack }) {
  const { user } = useAuth();
  const threads = cardThreads(track, user?.role);
  const vendors = useApi(() => (threads.vendors && track.rfqId ? chatApi.vendorThreads(track.rfqId) : Promise.resolve([])), [track.rfqId, threads.vendors]);
  // A vendor's two tabs each show their own unread count.
  const counts = useApi(() => (threads.own && threads.pr ? chatApi.unread() : Promise.resolve(null)), [threads.own, threads.pr]);
  const [tab, setTab] = useState<string>(threads.pr ? 'pr' : threads.own ? 'own' : '');
  const reloadVendors = vendors.reload;
  const reloadCounts = counts.reload;

  // Keep each tab's unread count current as conversations are read.
  useEffect(() => {
    if (!threads.vendors && !threads.own) return;
    const onRead = () => {
      if (threads.vendors) void reloadVendors();
      if (threads.own && threads.pr) void reloadCounts();
    };
    window.addEventListener(CHAT_READ_EVENT, onRead);
    return () => window.removeEventListener(CHAT_READ_EVENT, onRead);
  }, [threads.vendors, threads.own, threads.pr, reloadVendors, reloadCounts]);
  // Without a PR conversation, open the first vendor conversation.
  useEffect(() => {
    if (!tab && vendors.data?.length) setTab(vendors.data[0].vendorId);
  }, [tab, vendors.data]);

  if (threads.own && track.rfqId) {
    if (!threads.pr) return <VendorChat rfqId={track.rfqId} label="Your conversation with the buyer" />;
    // Once their PO is issued, the vendor has the order's conversation as well as their private line to the buyer.
    const orderUnread = track.prId ? counts.data?.prs[track.prId] ?? 0 : 0;
    const privateUnread = counts.data?.rfqs[track.rfqId] ?? 0;
    return (
      <>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'pr'} className={`tab${tab === 'pr' ? ' tab-active' : ''}`} onClick={() => setTab('pr')}>
            Order conversation
            {orderUnread > 0 && <span className="chat-badge chat-badge-inline">{orderUnread}</span>}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'own'} className={`tab${tab === 'own' ? ' tab-active' : ''}`} onClick={() => setTab('own')}>
            Private with the buyer
            {privateUnread > 0 && <span className="chat-badge chat-badge-inline">{privateUnread}</span>}
          </button>
        </div>
        {tab === 'pr' && track.prId && <PrChat prId={track.prId} prNumber={track.reference} />}
        {tab === 'own' && <VendorChat rfqId={track.rfqId} label="Your conversation with the buyer" />}
      </>
    );
  }
  const vendor = vendors.data?.find((v) => v.vendorId === tab);
  return (
    <>
      <ErrorBanner message={vendors.error} />
      {threads.vendors && (
        <div className="tabs" role="tablist">
          {threads.pr && (
            <button type="button" role="tab" aria-selected={tab === 'pr'} className={`tab${tab === 'pr' ? ' tab-active' : ''}`} onClick={() => setTab('pr')}>
              PR / PO conversation
            </button>
          )}
          {vendors.data?.map((v) => (
            <button key={v.vendorId} type="button" role="tab" aria-selected={tab === v.vendorId} className={`tab${tab === v.vendorId ? ' tab-active' : ''}`} onClick={() => setTab(v.vendorId)}>
              Vendor: {v.companyName}
              {v.unread > 0 && <span className="chat-badge chat-badge-inline">{v.unread}</span>}
            </button>
          ))}
        </div>
      )}
      {tab === 'pr' && track.prId && <PrChat prId={track.prId} prNumber={track.reference} vendorCanRead={vendorJoined(track)} />}
      {vendor && track.rfqId && <VendorChat rfqId={track.rfqId} vendorId={vendor.vendorId} label={`Private conversation with ${vendor.companyName}`} />}
      {!threads.pr && vendors.data && !vendors.data.length && <Empty>No vendors on this RFQ yet.</Empty>}
    </>
  );
}

/** One track: every step from start to finish, the current one highlighted, and who it waits on. */
export function TrackView({ track, withChat = false, unread = 0, onChatClosed }: { track: JourneyTrack; withChat?: boolean; unread?: number; onChatClosed?: () => void }) {
  const { user } = useAuth();
  const [chatting, setChatting] = useState(false);
  const threads = cardThreads(track, user?.role);
  const canChat = withChat && (threads.pr || threads.vendors || threads.own);
  return (
    <article className={`journey${track.yourAction ? ' journey-mine' : ''}`}>
      <header className="journey-head">
        <div className="journey-identity">
          <div className="journey-ref mono">{track.reference}</div>
          <div className="journey-field">
            <span className="journey-field-label">Title</span>
            <strong>{track.title || '—'}</strong>
          </div>
          <div className="journey-field">
            <span className="journey-field-label">Description</span>
            <span className={track.description ? '' : 'muted'}>{track.description || '—'}</span>
          </div>
        </div>
        <span className="journey-message-wrap">
          <span className={`journey-message${track.yourAction ? ' journey-message-mine' : ''}`}>
            {/* Only ever an instruction from the server, never a bare step name; without one, say what the card is waiting on. */}
            {track.yourAction && track.actionLabel ? `Your action: ${track.actionLabel}` : track.message}
          </span>
          <span className="journey-actions">
            {track.yourAction && <GoToTask step={track.steps.find((s) => s.state === 'current')?.label} />}
            {canChat && <ChatButton count={unread} subject={track.reference} onClick={() => setChatting(true)} />}
          </span>
        </span>
      </header>
      {chatting && (
        <Modal
          title={`Conversation: ${track.reference} ${track.title}`}
          onClose={() => {
            setChatting(false);
            onChatClosed?.();
          }}
          wide
        >
          <CardChat track={track} />
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
  const { user } = useAuth();
  const { data, error } = useApi(() => journeyApi.mine());
  const unread = useApi(() => chatApi.unread());
  const reloadUnread = unread.reload;
  const refreshUnread = useCallback(() => void reloadUnread(), [reloadUnread]);

  // Each card's unread badge stays current: every 15 seconds, on focus, and whenever a conversation is read.
  useEffect(() => {
    const timer = window.setInterval(refreshUnread, 15_000);
    window.addEventListener('focus', refreshUnread);
    window.addEventListener(CHAT_READ_EVENT, refreshUnread);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshUnread);
      window.removeEventListener(CHAT_READ_EVENT, refreshUnread);
    };
  }, [refreshUnread]);

  return (
    <Card title="Your journey">
      <ErrorBanner message={error} />
      {/* A failed count must not read as "nothing unread": say so, and keep the last badges shown. */}
      {unread.error && (
        <p className="muted small" role="status">
          Unread message counts could not be loaded ({unread.error}). Retrying every 15 seconds.
        </p>
      )}
      {data && !data.tracks.length && <Empty>Nothing in progress right now.</Empty>}
      {data && data.yourActions > 0 && (
        <p className="journey-summary">
          <strong>{data.yourActions}</strong> {data.yourActions === 1 ? 'item is' : 'items are'} waiting on you.
        </p>
      )}
      <div className="journeys">
        {data?.tracks.map((track) => (
          <TrackView key={track.id} track={track} withChat unread={cardUnread(track, unread.data, user?.role)} onChatClosed={refreshUnread} />
        ))}
      </div>
    </Card>
  );
}
