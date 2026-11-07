import { ROLES } from '../constants/roles';
import { APPROVAL_STATUS } from '../constants/status';
import { DoaDocumentType, DoaRule } from '../models/DoaRule';
import { IPoApproval, PurchaseOrderDocument } from '../models/PurchaseOrder';
import { AuthUser } from '../types/auth';
import { ApiError } from '../utils/ApiError';

const findRule = (documentType: DoaDocumentType, amount: number) =>
  DoaRule.findOne({
    documentType,
    isActive: true,
    minAmount: { $lte: amount },
    $or: [{ maxAmount: null }, { maxAmount: { $gte: amount } }],
  }).sort({ minAmount: -1 });

/** The extra approval levels a PR or payment of this value needs. Unlike a PO, having no rule is fine: it means none. */
export async function optionalApprovalChain(documentType: 'PR' | 'PAYMENT', amount: number) {
  const rule = await findRule(documentType, amount);
  return [...(rule?.levels ?? [])].sort((a, b) => a.level - b.level);
}

/** Finds the active DoA rule covering `amount` and expands it into a pending approval chain. */
export async function resolveApprovalChain(amount: number) {
  const rule = await findRule('PO', amount);

  if (!rule) {
    throw ApiError.unprocessable(
      `No active Delegation of Authority rule covers a PO of ${amount}. An administrator must add one under Administration.`,
    );
  }

  const approvals: IPoApproval[] = [...rule.levels]
    .sort((a, b) => a.level - b.level)
    .map((l) => ({ level: l.level, role: l.role, status: APPROVAL_STATUS.PENDING }));

  return { rule, approvals };
}

/**
 * Validates that `user` may act on the PO's current approval step and returns that step.
 *  - The user must hold the step's role (HOD must head the PO's department).
 *  - The final approver's personal DoA limit must cover the PO value.
 *  - The PO creator cannot approve their own PO (segregation of duties).
 */
export function assertCanApprove(po: PurchaseOrderDocument, user: AuthUser): IPoApproval {
  const pendingIndex = po.approvals.findIndex((a) => a.status === APPROVAL_STATUS.PENDING);
  if (pendingIndex === -1) {
    throw ApiError.unprocessable('PO has no pending approval step');
  }
  const step = po.approvals[pendingIndex];
  const isAdmin = user.role === ROLES.ADMIN;

  if (!isAdmin && user.role !== step.role) {
    throw ApiError.forbidden(`Approval level ${step.level} requires role ${step.role}`);
  }
  if (!isAdmin && step.role === ROLES.HOD && user.department !== po.department.toString()) {
    throw ApiError.forbidden('Only the HOD of the ordering department can approve this level');
  }
  if (po.createdBy.toString() === user.id) {
    throw ApiError.forbidden('Segregation of duties: the PO creator cannot approve it');
  }
  if (po.approvals.some((a) => a.actedBy?.toString() === user.id)) {
    throw ApiError.forbidden('You have already approved an earlier level of this PO');
  }

  const isFinalStep = pendingIndex === po.approvals.length - 1;
  if (isFinalStep && user.doaLimit < po.grandTotal) {
    throw ApiError.forbidden(
      `PO value ${po.grandTotal} exceeds your Delegation of Authority limit of ${user.doaLimit}`,
    );
  }

  return step;
}
