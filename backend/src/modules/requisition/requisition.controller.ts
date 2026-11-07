import { FilterQuery } from 'mongoose';
import { ROLES } from '../../constants/roles';
import { APPROVAL_STATUS, PR_STATUS, RATIFICATION_STATUS } from '../../constants/status';
import { currentUser } from '../../middleware/auth';
import { Department } from '../../models/Department';
import { IPurchaseRequisition, PurchaseRequisition, PurchaseRequisitionDocument } from '../../models/PurchaseRequisition';
import { PrMessage, PrMessageDocument } from '../../models/PrMessage';
import { optionalApprovalChain } from '../../services/doa.service';
import { trackForRequisition } from '../../services/journey.service';
import { loadDirectory, prPendingAt } from '../../services/workflow.service';
import { AuthUser } from '../../types/auth';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { oid } from '../../utils/objectId';
import { nextDocNumber } from '../../utils/sequence';

/** Which PRs each role may see. */
function visibilityScope(user: AuthUser): FilterQuery<IPurchaseRequisition> {
  switch (user.role) {
    case ROLES.ADMIN:
    case ROLES.AUDITOR:
    case ROLES.FINANCE:
      return {};
    case ROLES.HOD:
      return { department: user.department };
    case ROLES.PROCUREMENT:
      // Procurement also sees a PR while a PR approval step is theirs.
      return {
        $or: [
          { status: { $in: [PR_STATUS.APPROVED, PR_STATUS.SOURCING, PR_STATUS.PO_CREATED] } },
          { status: PR_STATUS.SUBMITTED, approvals: { $elemMatch: { role: ROLES.PROCUREMENT, status: APPROVAL_STATUS.PENDING } } },
        ],
      };
    default:
      return { requester: user.id };
  }
}

async function loadPr(id: string, user: AuthUser): Promise<PurchaseRequisitionDocument> {
  const pr = await PurchaseRequisition.findOne({ $and: [{ _id: id }, visibilityScope(user)] });
  if (!pr) throw ApiError.notFound('Purchase requisition');
  return pr;
}

function assertOwner(pr: PurchaseRequisitionDocument, user: AuthUser) {
  if (pr.requester.toString() !== user.id) {
    throw ApiError.forbidden('Only the requester can modify this PR');
  }
}

function assertDepartmentAuthority(pr: PurchaseRequisitionDocument, user: AuthUser) {
  if (user.role === ROLES.ADMIN) return;
  if (user.role !== ROLES.HOD || pr.department.toString() !== user.department) {
    throw ApiError.forbidden('Only the HOD of the requesting department can do this');
  }
}

function assertStatus(pr: PurchaseRequisitionDocument, allowed: string[]) {
  if (!allowed.includes(pr.status)) {
    throw ApiError.unprocessable(`Action not allowed while PR is ${pr.status}`);
  }
}

function assertActive(pr: PurchaseRequisitionDocument) {
  if (!pr.isActive) throw ApiError.unprocessable('PR is deactivated');
}

const audit = (pr: PurchaseRequisitionDocument, action: string, user: AuthUser, remarks?: string) =>
  pr.history.push({ action, by: oid(user.id), at: new Date(), remarks });

/** The HOD always comes first. A PR DoA rule adds further levels by value; an emergency PR stops at the HOD, and Finance ratifies later. */
async function approvalChain(pr: PurchaseRequisitionDocument) {
  const extra = pr.isEmergency ? [] : await optionalApprovalChain('PR', pr.totalEstimate);
  const roles = [ROLES.HOD, ...extra.map((l) => l.role).filter((role) => role !== ROLES.HOD)];
  return roles.map((role, index) => ({ level: index + 1, role, status: APPROVAL_STATUS.PENDING }));
}

/** The caller's approval step, or why they may not take it. Anyone may be Admin, who stands in for any role. */
function assertCanActOnStep(pr: PurchaseRequisitionDocument, user: AuthUser) {
  const step = pr.approvals.find((a) => a.status === APPROVAL_STATUS.PENDING);
  if (!step) throw ApiError.unprocessable('This PR has no pending approval step');
  if (user.role !== ROLES.ADMIN) {
    if (user.role !== step.role) throw ApiError.forbidden(`Action locked: this approval is pending at ${step.role}`);
    if (step.role === ROLES.HOD) assertDepartmentAuthority(pr, user);
  }
  if (pr.requester.toString() === user.id) {
    throw ApiError.forbidden('Segregation of duties: you cannot approve your own PR');
  }
  if (pr.approvals.some((a) => a.actedBy?.toString() === user.id)) {
    throw ApiError.forbidden('You have already acted on an earlier level of this PR');
  }
  return step;
}

// ---------------------------------------------------------------------------------

export const listRequisitions = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const conditions: FilterQuery<IPurchaseRequisition>[] = [visibilityScope(user)];
  if (req.query.status) conditions.push({ status: String(req.query.status) });
  if (req.query.active !== undefined) conditions.push({ isActive: req.query.active === 'true' });

  const prs = await PurchaseRequisition.find({ $and: conditions })
    .populate('requester', 'name email')
    .populate('department', 'name code')
    .sort({ createdAt: -1 });
  const directory = await loadDirectory(user);
  res.json(
    prs.map((pr) => {
      const view = pr.toObject();
      const department = pr.department as unknown as { _id: IPurchaseRequisition['department'] } | undefined;
      return { ...view, pendingAt: prPendingAt({ ...view, department: department?._id } as IPurchaseRequisition, directory) };
    }),
  );
});

export const getRequisition = asyncHandler(async (req, res) => {
  const pr = await loadPr(req.params.id, currentUser(req));
  await pr.populate([
    { path: 'requester', select: 'name email' },
    { path: 'department', select: 'name code budget' },
    { path: 'history.by', select: 'name role' },
  ]);
  res.json(pr);
});

/**
 * Puts a PR in front of its approvers: checks the department and its headroom, then sets a fresh approval
 * chain. Used when a PR is created, edited, or sent back after a rejection, so a change is always re-approved.
 */
async function sendForApproval(pr: PurchaseRequisitionDocument, user: AuthUser, action: string) {
  const dept = await Department.findById(pr.department);
  if (!dept || !dept.isActive) throw ApiError.unprocessable('Select an active department');
  const available = dept.budget.allocated - dept.budget.committed;
  if (pr.totalEstimate > available) {
    throw ApiError.unprocessable('Insufficient department budget', { required: pr.totalEstimate, available });
  }
  pr.set('approvals', await approvalChain(pr));
  pr.status = PR_STATUS.SUBMITTED;
  audit(pr, action, user);
}

/** A new PR goes straight to its approvers: there are no drafts. */
export const createRequisition = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const pr = new PurchaseRequisition({
    ...req.body,
    prNumber: await nextDocNumber('PR'),
    requester: user.id,
  });
  await pr.validate();
  await sendForApproval(pr, user, 'SUBMITTED');
  await pr.save();
  res.status(201).json(pr);
});

/**
 * The requester changes their PR after submitting it, until it is approved. Any approval already given
 * is cleared, because the PR being approved is no longer the same one.
 */
export const updateRequisition = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const pr = await loadPr(req.params.id, user);
  assertOwner(pr, user);
  assertActive(pr);
  assertStatus(pr, [PR_STATUS.DRAFT, PR_STATUS.SUBMITTED, PR_STATUS.REJECTED]);

  pr.set(req.body);
  await pr.validate();
  await sendForApproval(pr, user, 'EDITED');
  await pr.save();
  res.json(pr);
});

/** Sends an older draft, or a rejected PR as it stands, for approval. */
export const submitRequisition = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const pr = await loadPr(req.params.id, user);
  assertOwner(pr, user);
  assertActive(pr);
  assertStatus(pr, [PR_STATUS.DRAFT, PR_STATUS.REJECTED]);
  await sendForApproval(pr, user, 'SUBMITTED');
  await pr.save();
  res.json(pr);
});

/**
 * Takes the next approval step. The final step atomically commits the PR estimate against the
 * department budget, so the budget is locked only once the whole chain has approved.
 */
export const approveRequisition = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const pr = await loadPr(req.params.id, user);
  assertActive(pr);
  assertStatus(pr, [PR_STATUS.SUBMITTED]);
  // A PR submitted before chains existed has none yet.
  if (!pr.approvals.length) pr.set('approvals', await approvalChain(pr));

  const step = assertCanActOnStep(pr, user);
  step.status = APPROVAL_STATUS.APPROVED;
  step.actedBy = oid(user.id);
  step.actedAt = new Date();
  step.remarks = req.body.remarks;

  if (pr.approvals.some((a) => a.status === APPROVAL_STATUS.PENDING)) {
    audit(pr, `APPROVED_L${step.level}`, user, req.body.remarks);
    await pr.save();
    return res.json(pr);
  }

  const committed = await Department.findOneAndUpdate(
    {
      _id: pr.department,
      isActive: true,
      $expr: { $gte: [{ $subtract: ['$budget.allocated', '$budget.committed'] }, pr.totalEstimate] },
    },
    { $inc: { 'budget.committed': pr.totalEstimate } },
    { new: true },
  );
  if (!committed) throw ApiError.unprocessable('Insufficient department budget to approve this PR');

  pr.status = PR_STATUS.APPROVED;
  pr.approval = { by: oid(user.id), at: new Date(), remarks: req.body.remarks };
  audit(pr, 'APPROVED', user, req.body.remarks);
  try {
    await pr.save();
  } catch (err) {
    await Department.updateOne({ _id: pr.department }, { $inc: { 'budget.committed': -pr.totalEstimate } });
    throw err;
  }
  res.json(pr);
});

export const rejectRequisition = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const pr = await loadPr(req.params.id, user);
  assertStatus(pr, [PR_STATUS.SUBMITTED]);
  if (!pr.approvals.length) pr.set('approvals', await approvalChain(pr));
  const step = assertCanActOnStep(pr, user);
  step.status = APPROVAL_STATUS.REJECTED;
  step.actedBy = oid(user.id);
  step.actedAt = new Date();
  step.remarks = req.body.remarks;

  pr.status = PR_STATUS.REJECTED;
  audit(pr, 'REJECTED', user, req.body.remarks);
  await pr.save();
  res.json(pr);
});

/** Finance reviews an emergency purchase after the fact. Until it is ratified, the purchase cannot be paid. */
export const ratifyEmergency = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const status = req.body.decision === 'RATIFY' ? RATIFICATION_STATUS.RATIFIED : RATIFICATION_STATUS.REJECTED;
  const pr = await PurchaseRequisition.findOneAndUpdate(
    { _id: req.params.id, isEmergency: true, 'ratification.status': RATIFICATION_STATUS.PENDING, requester: { $ne: oid(user.id) } },
    {
      $set: { 'ratification.status': status, 'ratification.by': oid(user.id), 'ratification.at': new Date(), 'ratification.remarks': req.body.remarks },
      $push: { history: { action: `EMERGENCY_${status}`, by: oid(user.id), at: new Date(), remarks: req.body.remarks } },
    },
    { new: true },
  );
  if (!pr) throw ApiError.unprocessable('This requisition has no emergency purchase awaiting ratification');
  res.json(pr);
});

/** The requester, their HOD or an Admin cancels a PR before it is sourced. Releases committed budget if it had been approved. */
export const cancelRequisition = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const pr = await loadPr(req.params.id, user);
  const ownPr = user.role === ROLES.REQUESTER && pr.requester.toString() === user.id;
  if (!ownPr) assertDepartmentAuthority(pr, user);
  assertStatus(pr, [PR_STATUS.DRAFT, PR_STATUS.SUBMITTED, PR_STATUS.APPROVED, PR_STATUS.REJECTED]);

  if (pr.status === PR_STATUS.APPROVED) {
    await Department.updateOne({ _id: pr.department }, { $inc: { 'budget.committed': -pr.totalEstimate } });
  }
  pr.status = PR_STATUS.CANCELLED;
  pr.cancellation = { by: oid(user.id), at: new Date(), reason: req.body.reason };
  audit(pr, 'CANCELLED', user, req.body.reason);
  await pr.save();
  res.json(pr);
});

/** HOD/Admin freezes a PR: it stays on record but cannot be submitted, approved or sourced. */
export const deactivateRequisition = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const pr = await loadPr(req.params.id, user);
  assertDepartmentAuthority(pr, user);
  if (([PR_STATUS.SOURCING, PR_STATUS.PO_CREATED, PR_STATUS.CANCELLED] as string[]).includes(pr.status)) {
    throw ApiError.unprocessable(`Cannot deactivate a PR that is ${pr.status}`);
  }
  pr.isActive = false;
  audit(pr, 'DEACTIVATED', user, req.body.reason);
  await pr.save();
  res.json(pr);
});

export const reactivateRequisition = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const pr = await loadPr(req.params.id, user);
  assertDepartmentAuthority(pr, user);
  pr.isActive = true;
  audit(pr, 'REACTIVATED', user);
  await pr.save();
  res.json(pr);
});

// ---- Conversation on a PR -------------------------------------------------------

const messageView = (m: PrMessageDocument) => ({
  _id: m._id,
  sender: m.sender,
  senderName: m.senderName,
  senderRole: m.senderRole,
  text: m.text,
  createdAt: m.createdAt,
  readBy: m.readBy.map((r) => ({ user: r.user, name: r.name, at: r.at })),
});

/** The whole conversation on a PR, for anyone who can see the PR. Reading it marks the others' messages read. */
export const listMessages = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const pr = await loadPr(req.params.id, user);
  // An auditor looks on without taking part, so their reading is not a read receipt.
  if (user.role !== ROLES.AUDITOR) {
    await PrMessage.updateMany(
      { pr: pr._id, sender: { $ne: oid(user.id) }, 'readBy.user': { $ne: oid(user.id) } },
      { $push: { readBy: { user: oid(user.id), name: user.name, at: new Date() } } },
    );
  }
  const messages = await PrMessage.find({ pr: pr._id }).sort({ createdAt: 1 });
  res.json(messages.map(messageView));
});

export const postMessage = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const pr = await loadPr(req.params.id, user);
  const message = await PrMessage.create({ pr: pr._id, sender: user.id, senderName: user.name, senderRole: user.role, text: req.body.text });
  res.status(201).json(messageView(message));
});

/** The full journey of one PR, through its PO once there is one. */
export const requisitionJourney = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  res.json(await trackForRequisition(await loadPr(req.params.id, user), user));
});
