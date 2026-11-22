import { FilterQuery, Types } from 'mongoose';
import { ROLES, Role } from '../constants/roles';
import {
  BID_STATUS,
  INVOICE_STATUS,
  ITEM_TYPE,
  NEEDS_COMMISSIONING,
  PAYMENT_STATUS,
  PO_PAST_STATUSES,
  PO_STATUS,
  PR_STATUS,
  RATIFICATION_STATUS,
  RFQ_STATUS,
  SERVICE_ENTRY_STATUS,
} from '../constants/status';
import { Bid } from '../models/Bid';
import { Invoice, InvoiceDocument } from '../models/Invoice';
import { IPurchaseOrder, PurchaseOrder, PurchaseOrderDocument } from '../models/PurchaseOrder';
import { IPurchaseRequisition, PurchaseRequisition, PurchaseRequisitionDocument } from '../models/PurchaseRequisition';
import { Payment, PaymentDocument } from '../models/Payment';
import { RFQ, RfqDocument } from '../models/RFQ';
import { ServiceEntry } from '../models/ServiceEntry';
import { AuthUser } from '../types/auth';
import { Directory, PendingAt, activeRole, loadDirectory } from './workflow.service';
import { vendorRfqStatus } from './vendorRfq.service';

const MAX_TRACKS = 8;

type StepKind = 'Approval' | 'Task' | 'Process';

interface RawStep {
  label: string;
  kind: StepKind;
  done: boolean;
  owner?: PendingAt;
  /** Stops the track here, with this explanation */
  blocked?: string;
  /** Replaces the usual "pending at" message while this is the current step */
  note?: string;
  /** Consecutive steps with a group are shown together as one stage of the track */
  group?: string;
  detail?: string;
  /** What the owner does at this step, as an instruction ("Approve PR"). Defaults to ACTION_WORDS. */
  action?: string;
  /** Set when the owner has nothing to do yet at this step: what they are waiting for ("Waiting for vendor bids") */
  waiting?: string;
  /** A date shown with the step: when bidding ends, or when it closed */
  deadline?: StepDeadline;
}

interface StepDeadline {
  label: 'Ends' | 'Closed';
  at: Date;
}

/** When bidding on an RFQ ends, or when it closed. Its closing time is the deadline, or the moment a vendor was selected early. */
function biddingDeadline(rfq: RfqDocument | undefined): StepDeadline | undefined {
  if (!rfq || rfq.status === RFQ_STATUS.DRAFT || !rfq.closeAt) return undefined;
  const open = rfq.status === RFQ_STATUS.PUBLISHED && new Date() < rfq.closeAt;
  return { label: open ? 'Ends' : 'Closed', at: rfq.closeAt };
}

export interface JourneyStep {
  group?: string;
  label: string;
  /** What has happened, or what it is waiting for, in plain words */
  status: string;
  state: 'done' | 'current' | 'blocked' | 'locked';
  detail?: string;
  /** When bidding ends, or when it closed */
  deadline?: StepDeadline;
}

export interface JourneyTrack {
  id: string;
  reference: string;
  title: string;
  /** Shown under its own label: a PR's justification, or the RFQ description behind a PO */
  description?: string;
  steps: JourneyStep[];
  pendingAt?: PendingAt;
  message: string;
  /** True when the current step is the caller's to take now */
  yourAction: boolean;
  /** What the caller has to do, when it is their action ("Approve PR", "Record GRN") */
  actionLabel?: string;
  /** The PR behind this track, for its conversation. On a vendor track only once their PO is issued to them. */
  prId?: string;
  /** The RFQ behind this track, for the vendor conversations on it */
  rfqId?: string;
  startedAt: Date;
}

/** The caller's own work first, then the newest, cut to a length a dashboard can show. */
const mostRelevant = (tracks: JourneyTrack[]) =>
  [...tracks]
    .sort((a, b) => Number(b.yourAction) - Number(a.yourAction) || new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, MAX_TRACKS);

const TEAM_WORD: Record<string, string> = {
  REQUESTER: 'the requester',
  HOD: 'HOD',
  PROCUREMENT: 'Procurement',
  STORE: 'the Store',
  FINANCE: 'Finance',
  VENDOR: 'the vendor',
  ADMIN: 'the administrator',
};

/** [done, pending] wording for each step. Approval levels of a PR are worded from their role. */
const STEP_WORDS: Record<string, [string, string]> = {
  'PR raised': ['PR submitted', 'Waiting for the requester to submit'],
  'HOD approval': ['HOD approval completed', 'HOD approval pending: waiting for HOD review'],
  'RFQ published': ['RFQ published to vendors', 'Waiting for Procurement to initiate the RFQ'],
  Bidding: ['Bidding closed', 'Vendors are bidding'],
  'Vendor selected': ['Vendor selected', 'Waiting for Procurement to select a vendor'],
  'Emergency PO': ['Emergency PO raised', 'Waiting for Procurement to buy directly'],
  'PO generated': ['PO generated and issued to the vendor', 'Waiting for Procurement to generate the PO'],
  'PO received': ['PO received', 'Waiting for the buyer to issue the PO'],
  'Goods receipt & inspection': ['Goods received and inspected', 'Waiting for the Store to receive and inspect the goods'],
  'Service sign-off': ['Service sign-off completed', 'Waiting for the HOD to sign off the service'],
  'Commissioning sign-off': ['Commissioning sign-off completed', 'Waiting for the HOD to sign off commissioning'],
  Invoice: ['Invoice received', 'Waiting for the vendor invoice'],
  'Invoice verification & 3-way match': ['Invoice verified and booked', 'Waiting for Finance to verify the invoice'],
  'Emergency ratification': ['Emergency purchase ratified', 'Waiting for Finance to ratify the emergency purchase'],
  'Tax verification': ['Tax verification completed', 'Waiting for Finance to verify tax'],
  'Payment approval': ['Payment approval completed', 'Waiting for payment approval'],
  'Payment release': ['Payment released', 'Waiting for Finance to release the payment'],
  Closed: ['PO closed', 'Waiting for the PO to complete'],
  'Short-closed': ['PO short-closed', 'Waiting for the PO to complete'],
  'RFQ received': ['RFQ received', 'Waiting for the RFQ'],
  'Bid submitted': ['Your bid is in', 'Waiting for your bid'],
  'Bid withdrawn': ['You withdrew your bid', 'Waiting for your bid'],
  'Bidding closed': ['Bidding closed', 'Bidding is open'],
  'Selected by the buyer': ['You were selected', 'Waiting for the buyer'],
};

/** What the owner of each step does, as the instruction shown after "Your action:". */
const ACTION_WORDS: Record<string, string> = {
  'PR raised': 'Submit PR',
  'RFQ published': 'Initiate RFQ',
  'Vendor selected': 'Select vendor',
  'Emergency PO': 'Raise the emergency PO',
  'PO generated': 'Create PO',
  'Goods receipt & inspection': 'Record GRN',
  'Service sign-off': 'Sign off the service',
  'Commissioning sign-off': 'Sign off commissioning',
  Invoice: 'Submit invoice',
  'Invoice verification & 3-way match': 'Verify invoice',
  'Emergency ratification': 'Ratify the emergency purchase',
  'Tax verification': 'Verify tax',
  'Payment approval': 'Approve payment',
  'Payment release': 'Release payment',
  'Bid submitted': 'Submit bid',
  'Bid withdrawn': 'Submit bid',
};

function stepWords(step: RawStep): [string, string] {
  const words = STEP_WORDS[step.label];
  if (words) return words;
  const role = step.owner?.role;
  return [`${step.label} completed`, `Waiting for ${role ? TEAM_WORD[role] ?? step.owner?.label : 'this step'}`];
}

/** The first unfinished step is the current one: every step after it is locked until it completes. */
function toTrack(id: string, reference: string, title: string, raw: RawStep[], user: AuthUser, finished: string, startedAt: Date, description?: string): JourneyTrack {
  const currentIndex = raw.findIndex((s) => !s.done);
  const current = raw[currentIndex];
  const steps = raw.map((s, index): JourneyStep => {
    const [doneText, pendingText] = stepWords(s);
    const shown = { label: s.label, detail: s.detail, group: s.group, deadline: s.deadline };
    if (s.done) return { ...shown, state: 'done', status: doneText };
    if (index === currentIndex) return { ...shown, state: s.blocked ? 'blocked' : 'current', status: s.blocked ?? s.note ?? pendingText };
    return { ...shown, state: 'locked', status: 'Upcoming' };
  });
  const mine = !!current && !current.blocked && current.owner?.role === user.role;
  // The owner of a step that is only waiting on someone else is told what it is waiting for, not given an action.
  const waiting = mine ? current.waiting : undefined;
  const message = !current
    ? finished
    : waiting ?? current.blocked ?? current.note ?? (current.owner ? `${current.kind} pending at ${current.owner.label}` : `${current.label} is in progress`);
  const yourAction = mine && !waiting;
  return {
    id,
    reference,
    title,
    description: description?.trim() || undefined,
    steps,
    pendingAt: current?.blocked ? undefined : current?.owner,
    message,
    yourAction,
    actionLabel: yourAction ? current.action ?? ACTION_WORDS[current.label] ?? current.label : undefined,
    startedAt,
  };
}

interface PoRecords {
  invoices: InvoiceDocument[];
  payments: PaymentDocument[];
  pendingSignOff: boolean;
}

const PAST_BOOKING: string[] = [INVOICE_STATUS.BOOKED, INVOICE_STATUS.TAX_VERIFIED, INVOICE_STATUS.PAID];
const FINANCE_STAGE = 'Finance';
const PAST_TAX: string[] = [INVOICE_STATUS.TAX_VERIFIED, INVOICE_STATUS.PAID];

const createdAt = (doc: unknown) => (doc as { createdAt: Date }).createdAt;
const qtyDetail = (done: number, of: number) => `${done} of ${of}`;

/** The stages shared by every PO, from receipt to payment. */
function deliveryAndPaymentSteps(po: IPurchaseOrder, records: PoRecords, at: Directory): RawStep[] {
  const goods = po.items.filter((i) => i.itemType !== ITEM_TYPE.SERVICE);
  const signOff = po.items.filter((i) => i.itemType === ITEM_TYPE.SERVICE || NEEDS_COMMISSIONING.includes(i.itemType));
  const invoices = records.invoices.filter((i) => i.status !== INVOICE_STATUS.REJECTED);
  const all = (statuses: string[]) => invoices.length > 0 && invoices.every((i) => statuses.includes(i.status));
  const billedInFull = po.items.every((i) => i.invoicedQty >= i.quantity);

  // The vendor invoices on dispatch, before the goods are received and inspected.
  const steps: RawStep[] = [{ label: 'Invoice', kind: 'Task', done: billedInFull || invoices.length > 0, owner: at(ROLES.VENDOR) }];
  if (goods.length) {
    const received = goods.reduce((s, i) => s + i.receivedQty, 0);
    const ordered = goods.reduce((s, i) => s + i.quantity, 0);
    steps.push({
      label: 'Goods receipt & inspection',
      kind: 'Task',
      done: received >= ordered,
      owner: at(ROLES.STORE),
      detail: received > 0 ? qtyDetail(received, ordered) : undefined,
    });
  }
  if (signOff.length) {
    const label = signOff.some((i) => NEEDS_COMMISSIONING.includes(i.itemType)) ? 'Commissioning sign-off' : 'Service sign-off';
    const finished = signOff.every((i) => (i.itemType === ITEM_TYPE.SERVICE ? i.receivedQty >= i.quantity : i.commissionedQty >= i.quantity));
    steps.push({
      label,
      kind: 'Approval',
      done: finished,
      owner: at(ROLES.HOD, po.department),
      detail: records.pendingSignOff ? 'Awaiting acceptance' : undefined,
    });
  }

  const exception = invoices.find((i) => i.status === INVOICE_STATUS.EXCEPTION);
  const failed = records.payments.find((p) => p.status === PAYMENT_STATUS.FAILED);
  const awaitingApproval = records.payments.find((p) => p.status === PAYMENT_STATUS.PENDING_APPROVAL);
  const processing = records.payments.some((p) => p.status === PAYMENT_STATUS.PROCESSING);
  const nextPaymentStep = awaitingApproval?.approvals.find((a) => a.status === 'PENDING');


  // One Finance stage, from checking the invoice to paying it. Booking the liability is part of verifying the invoice.
  const finance = at(ROLES.FINANCE);
  const matched = invoices.some((i) => i.status === INVOICE_STATUS.MATCHED);
  steps.push(
    {
      group: FINANCE_STAGE,
      label: 'Invoice verification & 3-way match',
      kind: 'Process',
      done: all(PAST_BOOKING),
      owner: finance,
      detail: exception ? `${exception.match.exceptions.length} exception(s)` : matched ? 'Matched, ready to book' : undefined,
    },
    { group: FINANCE_STAGE, label: 'Tax verification', kind: 'Approval', done: all(PAST_TAX), owner: finance },
  );
  if (awaitingApproval) {
    steps.push({ group: FINANCE_STAGE, label: 'Payment approval', kind: 'Approval', done: false, owner: at(nextPaymentStep?.role as Role, po.department) });
  }
  steps.push({
    group: FINANCE_STAGE,
    label: 'Payment release',
    kind: 'Process',
    done: all([INVOICE_STATUS.PAID]),
    owner: finance,
    blocked: failed ? `Payment failed: ${failed.failureReason ?? 'see the failed-payment queue'}. Retry pending at ${finance.label}` : undefined,
    detail: processing ? 'With the bank' : undefined,
  });
  steps.push({
    label: po.shortClose?.at ? 'Short-closed' : 'Closed',
    kind: 'Task',
    done: po.status === PO_STATUS.CLOSED || po.status === PO_STATUS.SHORT_CLOSED,
    // Everything paid so far, but not everything delivered or billed: the rest is still to come.
    owner: po.items.every((i) => i.receivedQty >= i.quantity) ? at(ROLES.VENDOR) : at(ROLES.STORE),
    ...(po.items.every((i) => i.receivedQty >= i.quantity) ? { action: 'Invoice the rest of the PO' } : { waiting: 'Waiting for the PO to complete' }),
  });
  return steps;
}

/** The steps after the PO, for a requisition that has none yet: shown from the start, so the whole path is visible. */
function stepsAfterOrder(pr: IPurchaseRequisition, at: Directory): RawStep[] {
  const types = pr.items.map((i) => i.itemType);
  const steps: RawStep[] = [{ label: 'Invoice', kind: 'Task', done: false, owner: at(ROLES.VENDOR) }];
  if (types.some((t) => t !== ITEM_TYPE.SERVICE)) steps.push({ label: 'Goods receipt & inspection', kind: 'Task', done: false, owner: at(ROLES.STORE) });
  if (types.some((t) => t === ITEM_TYPE.SERVICE || NEEDS_COMMISSIONING.includes(t))) {
    steps.push({ label: types.some((t) => NEEDS_COMMISSIONING.includes(t)) ? 'Commissioning sign-off' : 'Service sign-off', kind: 'Approval', done: false, owner: at(ROLES.HOD, pr.department) });
  }
  const finance = at(ROLES.FINANCE);
  steps.push(
    { group: FINANCE_STAGE, label: 'Invoice verification & 3-way match', kind: 'Process', done: false, owner: finance },
    { group: FINANCE_STAGE, label: 'Tax verification', kind: 'Approval', done: false, owner: finance },
    { group: FINANCE_STAGE, label: 'Payment release', kind: 'Process', done: false, owner: finance },
    { label: 'Closed', kind: 'Task', done: false, owner: at(ROLES.VENDOR), waiting: 'Waiting for the PO to complete' },
  );
  return steps;
}

function requisitionSteps(pr: IPurchaseRequisition, at: Directory): RawStep[] {
  const steps: RawStep[] = [
    {
      label: 'PR raised',
      kind: 'Task',
      done: ![PR_STATUS.DRAFT, PR_STATUS.REJECTED].includes(pr.status as 'DRAFT'),
      owner: at(ROLES.REQUESTER, pr.department),
      blocked: pr.status === PR_STATUS.REJECTED ? 'Rejected: back with the requester to revise and resubmit' : undefined,
    },
  ];
  const chain = pr.approvals?.length ? pr.approvals : [{ level: 1, role: ROLES.HOD, status: 'PENDING' }];
  const approved = !([PR_STATUS.DRAFT, PR_STATUS.SUBMITTED, PR_STATUS.REJECTED] as string[]).includes(pr.status);
  for (const step of chain) {
    steps.push({
      label: activeRole(step.role) === ROLES.HOD ? 'HOD approval' : `${activeRole(step.role).charAt(0)}${activeRole(step.role).slice(1).toLowerCase()} approval`,
      kind: 'Approval',
      done: approved || step.status === 'APPROVED',
      owner: at(step.role, pr.department),
      action: 'Approve PR',
    });
  }
  return steps;
}

/**
 * What Procurement sees at the bidding step: while it is open with no bids it only waits for vendors; once
 * bids are in it can close bidding and select one; after bidding has closed it selects a vendor, unless
 * no vendor bid at all.
 */
function biddingWords(rfq: RfqDocument | undefined, bids: number): Pick<RawStep, 'action' | 'waiting'> {
  if (!rfq || rfq.status !== RFQ_STATUS.PUBLISHED) return {};
  if (new Date() >= rfq.closeAt) return bids > 0 ? { action: 'Select vendor' } : { waiting: NO_BIDS };
  return bids > 0 ? { action: 'Close bid & select vendor' } : { waiting: 'Waiting for vendor bids' };
}

const NO_BIDS = 'No bids received';

function sourcingSteps(rfq: RfqDocument | undefined, at: Directory, emergency: boolean, bids = 0): RawStep[] {
  if (emergency) return [{ label: 'Emergency PO', kind: 'Task', done: rfq?.status === RFQ_STATUS.AWARDED, owner: at(ROLES.PROCUREMENT) }];
  const procurement = at(ROLES.PROCUREMENT);
  const closed = !!rfq && ([RFQ_STATUS.CLOSED, RFQ_STATUS.AWARDED] as string[]).includes(rfq.status);
  const steps: RawStep[] = [
    { label: 'RFQ published', kind: 'Task', done: !!rfq && rfq.status !== RFQ_STATUS.DRAFT, owner: procurement, action: rfq ? 'Publish RFQ' : 'Initiate RFQ' },
    { label: 'Bidding', kind: 'Process', done: closed, owner: procurement, detail: rfq ? rfq.rfqNumber : undefined, deadline: biddingDeadline(rfq), ...biddingWords(rfq, bids) },
  ];
  const escalation = rfq?.budgetEscalation?.status === 'PENDING';
  steps.push({
    label: 'Vendor selected',
    kind: escalation ? 'Approval' : 'Task',
    done: rfq?.status === RFQ_STATUS.AWARDED,
    owner: escalation ? at(ROLES.FINANCE) : procurement,
    action: escalation ? 'Approve the budget escalation' : 'Select vendor',
    // Bidding closed with nobody bidding: there is no vendor to select.
    ...(!escalation && rfq?.status === RFQ_STATUS.CLOSED && bids === 0 && { waiting: NO_BIDS }),
    detail: escalation ? 'Budget escalation' : undefined,
  });
  return steps;
}

/**
 * One step from the vendor selection to a PO the vendor and Store can act on. Within Procurement's authority
 * the PO is approved and issued the moment the vendor is selected. Above it, the step waits on the HOD or
 * Finance level that is still pending. An emergency PO is issued at once and ratified by Finance later.
 */
function orderSteps(po: PurchaseOrderDocument | undefined, at: Directory): RawStep[] {
  const next = po?.status === PO_STATUS.PENDING_APPROVAL ? po.approvals.find((a) => a.status === 'PENDING') : undefined;
  const generated = !!po && !([PO_STATUS.PENDING_APPROVAL, PO_STATUS.REJECTED, PO_STATUS.APPROVED] as string[]).includes(po.status);
  const approver = next ? activeRole(next.role) : undefined;
  return [
    {
      label: 'PO generated',
      kind: next ? 'Approval' : 'Task',
      done: generated,
      owner: next ? at(next.role, po?.department) : at(ROLES.PROCUREMENT),
      action: next ? 'Approve PO' : 'Create PO',
      blocked: po?.status === PO_STATUS.REJECTED ? 'PO rejected at approval' : undefined,
      note: approver ? `PO approval pending: above Procurement authority, waiting for ${TEAM_WORD[approver] ?? approver}` : undefined,
    },
  ];
}

async function loadPoRecords(pos: PurchaseOrderDocument[]) {
  const ids = pos.map((po) => po._id);
  const [invoices, pendingSignOff] = await Promise.all([
    Invoice.find({ purchaseOrder: { $in: ids } }),
    ServiceEntry.find({ purchaseOrder: { $in: ids }, status: SERVICE_ENTRY_STATUS.PENDING }).distinct('purchaseOrder'),
  ]);
  const payments = await Payment.find({ invoice: { $in: invoices.map((i) => i._id) } });
  const signOff = new Set(pendingSignOff.map(String));
  return (po: PurchaseOrderDocument): PoRecords => {
    const own = invoices.filter((i) => i.purchaseOrder.equals(po._id));
    const invoiceIds = new Set(own.map((i) => i._id.toString()));
    return {
      invoices: own,
      payments: payments.filter((p) => invoiceIds.has(p.invoice.toString())),
      pendingSignOff: signOff.has(po._id.toString()),
    };
  };
}

function internalPrScope(user: AuthUser): FilterQuery<IPurchaseRequisition> | null {
  switch (user.role) {
    case ROLES.REQUESTER:
      return { requester: new Types.ObjectId(user.id) };
    case ROLES.HOD:
      return { department: user.department };
    case ROLES.PROCUREMENT:
      return { status: { $in: [PR_STATUS.APPROVED, PR_STATUS.SOURCING] } };
    case ROLES.FINANCE:
    case ROLES.ADMIN:
    case ROLES.AUDITOR:
      return {};
    default:
      return null;
  }
}

function poTrack(po: PurchaseOrderDocument, pr: PurchaseRequisitionDocument | undefined, rfq: RfqDocument | undefined, records: PoRecords, at: Directory, user: AuthUser) {
  const steps: RawStep[] = [
    ...(pr ? requisitionSteps(pr, at) : []),
    ...sourcingSteps(rfq, at, po.isEmergency),
    ...orderSteps(po, at),
    ...deliveryAndPaymentSteps(po, records, at),
  ];
  if (pr?.isEmergency && pr.ratification?.status !== RATIFICATION_STATUS.RATIFIED) {
    steps.splice(steps.findIndex((s) => s.label === 'Tax verification'), 0, {
      group: FINANCE_STAGE,
      label: 'Emergency ratification',
      kind: 'Approval',
      done: false,
      owner: at(ROLES.FINANCE),
      blocked: pr.ratification?.status === RATIFICATION_STATUS.REJECTED ? 'Finance refused to ratify this emergency purchase: it cannot be paid' : undefined,
    });
  }
  // A PO's title is its RFQ title; its description the RFQ description, or the requisition's justification.
  const title = rfq?.title || pr?.title || po.poNumber;
  const description = rfq?.description || pr?.justification;
  return { ...toTrack(po._id.toString(), po.poNumber, title, steps, user, 'Complete', createdAt(po), description), prId: pr?._id.toString(), rfqId: po.rfq.toString() };
}

function prTrack(pr: PurchaseRequisitionDocument, rfq: RfqDocument | undefined, at: Directory, user: AuthUser, bids = 0) {
  const steps = [...requisitionSteps(pr, at), ...sourcingSteps(rfq, at, pr.isEmergency, bids), ...orderSteps(undefined, at), ...stepsAfterOrder(pr, at)];
  if (pr.status === PR_STATUS.CANCELLED) {
    steps[0] = { ...steps[0], done: false, blocked: `Cancelled: ${pr.cancellation?.reason ?? 'no reason given'}` };
  }
  return { ...toTrack(pr._id.toString(), pr.prNumber, pr.title, steps, user, 'Complete', createdAt(pr), pr.justification), prId: pr._id.toString(), rfqId: pr.rfq?.toString() };
}

/** Live (not withdrawn) bids on each RFQ. */
async function liveBidCounts(rfqIds: Types.ObjectId[]): Promise<Map<string, number>> {
  if (!rfqIds.length) return new Map();
  const rows = await Bid.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { rfq: { $in: rfqIds }, status: { $ne: BID_STATUS.WITHDRAWN } } },
    { $group: { _id: '$rfq', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.n]));
}

/** The full track for one requisition, through its PO once there is one. The caller has already been allowed to see the PR. */
export async function trackForRequisition(pr: PurchaseRequisitionDocument, user: AuthUser): Promise<JourneyTrack> {
  const at = await loadDirectory(user);
  const po = pr.purchaseOrder ? await PurchaseOrder.findById(pr.purchaseOrder) : null;
  const rfq = await RFQ.findById(po?.rfq ?? pr.rfq);
  if (po) return poTrack(po, pr, rfq ?? undefined, (await loadPoRecords([po]))(po), at, user);
  const bids = rfq ? (await liveBidCounts([rfq._id])).get(rfq._id.toString()) ?? 0 : 0;
  return prTrack(pr, rfq ?? undefined, at, user, bids);
}

async function internalTracks(user: AuthUser): Promise<JourneyTrack[]> {
  const at = await loadDirectory(user);
  const prScope = internalPrScope(user);

  const poScope: FilterQuery<IPurchaseOrder> = { status: { $nin: PO_PAST_STATUSES } };
  if (user.role === ROLES.HOD) poScope.department = user.department;
  if (user.role === ROLES.REQUESTER) {
    poScope.requisitions = { $in: await PurchaseRequisition.find({ requester: user.id }).distinct('_id') };
  }
  const pos = await PurchaseOrder.find(poScope).sort({ createdAt: -1 }).limit(30);

  const openPrs: PurchaseRequisitionDocument[] = prScope
    ? await PurchaseRequisition.find({
        $and: [prScope, { status: { $in: [PR_STATUS.DRAFT, PR_STATUS.SUBMITTED, PR_STATUS.REJECTED, PR_STATUS.APPROVED, PR_STATUS.SOURCING] } }],
      })
        .sort({ createdAt: -1 })
        .limit(30)
    : [];
  const linkedPrs = await PurchaseRequisition.find({ _id: { $in: pos.flatMap((po) => po.requisitions) } });

  const rfqIds = [...pos.map((po) => po.rfq), ...openPrs.flatMap((pr) => (pr.rfq ? [pr.rfq] : []))];
  const rfqs = await RFQ.find({ _id: { $in: rfqIds } });
  const rfqById = new Map(rfqs.map((r) => [r._id.toString(), r]));
  const prById = new Map(linkedPrs.map((pr) => [pr._id.toString(), pr]));
  const recordsFor = await loadPoRecords(pos);

  const poTracks = pos.map((po) =>
    poTrack(po, prById.get(po.requisitions[0]?.toString() ?? ''), rfqById.get(po.rfq.toString()), recordsFor(po), at, user),
  );

  const bidsOn = await liveBidCounts(openPrs.flatMap((pr) => (pr.rfq ? [pr.rfq] : [])));
  const prTracks = openPrs.map((pr) => prTrack(pr, pr.rfq ? rfqById.get(pr.rfq.toString()) : undefined, at, user, pr.rfq ? bidsOn.get(pr.rfq.toString()) ?? 0 : 0));

  return mostRelevant([...poTracks, ...prTracks]);
}

/**
 * A vendor's track shows only their side, and never who else is involved by name. For a vendor who was
 * not selected it ends at "Bidding closed" and stays exactly that way before and after an award.
 */
async function vendorTracks(user: AuthUser): Promise<JourneyTrack[]> {
  const at = await loadDirectory(user);
  const rfqs = await RFQ.find({
    status: { $in: [RFQ_STATUS.PUBLISHED, RFQ_STATUS.CLOSED, RFQ_STATUS.AWARDED] },
    $or: [{ invitedVendors: user.vendor }, { invitedVendors: { $size: 0 } }],
  })
    .sort({ createdAt: -1 })
    .limit(60);
  const bids = await Bid.find({ rfq: { $in: rfqs.map((r) => r._id) }, vendor: user.vendor }).select('rfq status');
  const bidByRfq = new Map(bids.map((b) => [b.rfq.toString(), b]));

  const wonRfqs = rfqs.filter((r) => r.status === RFQ_STATUS.AWARDED && bidByRfq.get(r._id.toString())?.status === BID_STATUS.AWARDED);
  const pos = await PurchaseOrder.find({ rfq: { $in: wonRfqs.map((r) => r._id) }, vendor: user.vendor, status: { $ne: PO_STATUS.CANCELLED } });
  const poByRfq = new Map(pos.map((po) => [po.rfq.toString(), po]));
  const recordsFor = await loadPoRecords(pos);
  // The PR behind each RFQ this vendor won. A cancelled PO removes this link, so the vendor leaves its conversation.
  const wonPrs = await PurchaseRequisition.find({ rfq: { $in: wonRfqs.map((r) => r._id) } }).select('_id rfq');
  const prByRfq = new Map(wonPrs.map((pr) => [pr.rfq!.toString(), pr._id.toString()]));

  const tracks: JourneyTrack[] = [];
  for (const rfq of rfqs) {
    const key = rfq._id.toString();
    const bid = bidByRfq.get(key);
    const won = wonRfqs.includes(rfq);
    const status = vendorRfqStatus(rfq, won);
    const open = status === RFQ_STATUS.PUBLISHED;
    if (!open && !bid) continue;
    const withdrawn = bid?.status === BID_STATUS.WITHDRAWN;

    const steps: RawStep[] = [
      { label: 'RFQ received', kind: 'Task', done: true },
      { label: withdrawn ? 'Bid withdrawn' : 'Bid submitted', kind: 'Task', done: !!bid, owner: at(ROLES.VENDOR) },
      { label: 'Bidding closed', kind: 'Process', done: !open, note: 'Bidding is open. You can revise your bid until it closes.', deadline: biddingDeadline(rfq) },
    ];
    if (!won) {
      tracks.push({ ...toTrack(key, rfq.rfqNumber, rfq.title, steps, user, 'Bidding has closed. The buyer contacts the selected vendor directly.', createdAt(rfq), rfq.description), rfqId: key });
      continue;
    }

    const po = poByRfq.get(key);
    if (po && PO_PAST_STATUSES.includes(po.status)) continue;
    const issued = !!po && ![PO_STATUS.PENDING_APPROVAL, PO_STATUS.APPROVED, PO_STATUS.REJECTED].includes(po.status as 'APPROVED');
    steps.push({ label: 'Selected by the buyer', kind: 'Task', done: true });
    steps.push({ label: 'PO received', kind: 'Process', done: issued, owner: at(ROLES.PROCUREMENT) });
    if (po && issued) {
      steps.push(...deliveryAndPaymentSteps(po, recordsFor(po), at));
    }
    // From the moment they are selected, the vendor joins the order's conversation (the PR behind the RFQ and PO).
    const orderPr = prByRfq.get(key) ?? (issued && po && po.status !== PO_STATUS.CANCELLED ? po.requisitions[0]?.toString() : undefined);
    tracks.push({ ...toTrack(key, issued && po ? po.poNumber : rfq.rfqNumber, rfq.title, steps, user, 'Complete', createdAt(rfq), rfq.description), rfqId: key, prId: orderPr });
  }
  return mostRelevant(tracks);
}

export async function buildJourney(user: AuthUser) {
  const tracks = user.role === ROLES.VENDOR ? await vendorTracks(user) : await internalTracks(user);
  return { tracks, yourActions: tracks.filter((t) => t.yourAction).length };
}

