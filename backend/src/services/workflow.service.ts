import { Types } from 'mongoose';
import { MASTER_ROLES, ROLES, Role } from '../constants/roles';
import { APPROVAL_STATUS, INVOICE_STATUS, PAYMENT_STATUS, PO_STATUS, PR_STATUS } from '../constants/status';
import { Department } from '../models/Department';
import { IInvoice } from '../models/Invoice';
import { IPayment } from '../models/Payment';
import { IPurchaseOrder } from '../models/PurchaseOrder';
import { IPurchaseRequisition } from '../models/PurchaseRequisition';
import { User } from '../models/User';
import { AuthUser } from '../types/auth';

const TEAM: Record<Role, string> = {
  REQUESTER: 'Requesting department',
  HOD: 'Head of Department',
  PROCUREMENT: 'Procurement',
  STORE: 'Store',
  FINANCE: 'Finance',
  AUDITOR: 'Audit',
  VENDOR: 'Vendor',
  ADMIN: 'Administration',
};

/** Who a document is waiting on. */
export interface PendingAt {
  role: Role;
  /** Only set when the department is the caller's business to know */
  department?: string;
  /** Only set for internal viewers, and for roles held by one person */
  userName?: string;
  label: string;
}

export type Directory = (role: Role, department?: Types.ObjectId | string | null) => PendingAt;

const MERGED_INTO: Record<string, Role> = { QC: ROLES.STORE, AP: ROLES.FINANCE, TREASURY: ROLES.FINANCE };

/** The role that does this work today. An old record can still name a merged role, but nothing may send work there. */
export const activeRole = (role: string): Role => MERGED_INTO[role] ?? (role as Role);

/** Resolves roles to their department and, where one person holds the role, their name. Vendors get the team only. */
export async function loadDirectory(viewer: AuthUser): Promise<Directory> {
  if (viewer.role === ROLES.VENDOR) {
    return (named) => {
      const role = activeRole(named);
      return { role, label: TEAM[role] };
    };
  }
  const [masters, departments] = await Promise.all([
    User.find({ role: { $in: MASTER_ROLES }, isActive: true }).select('name role'),
    Department.find().select('name hod').populate<{ hod?: { name: string } }>('hod', 'name'),
  ]);
  const masterName = new Map(masters.map((u) => [u.role as string, u.name]));
  const departmentById = new Map(departments.map((d) => [d._id.toString(), d]));

  return (named, department) => {
    const role = activeRole(named);
    const dept = department ? departmentById.get(department.toString()) : undefined;
    const userName = role === ROLES.HOD ? dept?.hod?.name : masterName.get(role);
    const team = role === ROLES.HOD && dept ? `Head of Department, ${dept.name}` : TEAM[role];
    return { role, department: dept?.name, userName, label: userName ? `${team} (${userName})` : team };
  };
}

const nextStep = <T extends { status: string; role: Role }>(approvals: T[]) => approvals.find((a) => a.status === APPROVAL_STATUS.PENDING);

export function prPendingAt(pr: IPurchaseRequisition, at: Directory): PendingAt | undefined {
  if (!pr.isActive) return at(ROLES.HOD, pr.department);
  switch (pr.status) {
    case PR_STATUS.DRAFT:
    case PR_STATUS.REJECTED:
      return at(ROLES.REQUESTER, pr.department);
    case PR_STATUS.SUBMITTED:
      return at(nextStep(pr.approvals ?? [])?.role ?? ROLES.HOD, pr.department);
    case PR_STATUS.APPROVED:
    case PR_STATUS.SOURCING:
      return at(ROLES.PROCUREMENT);
    default:
      return undefined;
  }
}

export function poPendingAt(po: IPurchaseOrder, at: Directory): PendingAt | undefined {
  switch (po.status) {
    case PO_STATUS.PENDING_APPROVAL:
      return at(nextStep(po.approvals)?.role ?? ROLES.PROCUREMENT, po.department);
    case PO_STATUS.APPROVED:
      return at(ROLES.PROCUREMENT);
    case PO_STATUS.ISSUED:
      return at(ROLES.VENDOR);
    case PO_STATUS.ACKNOWLEDGED:
    case PO_STATUS.PARTIALLY_RECEIVED:
      return at(ROLES.STORE);
    case PO_STATUS.RECEIVED:
      return at(ROLES.FINANCE);
    default:
      return undefined;
  }
}

export function invoicePendingAt(invoice: IInvoice, at: Directory): PendingAt | undefined {
  switch (invoice.status) {
    case INVOICE_STATUS.SUBMITTED:
    case INVOICE_STATUS.MATCHED:
    case INVOICE_STATUS.EXCEPTION:
    case INVOICE_STATUS.BOOKED:
    case INVOICE_STATUS.TAX_VERIFIED:
      return at(ROLES.FINANCE);
    default:
      return undefined;
  }
}

export function paymentPendingAt(payment: IPayment, at: Directory): PendingAt | undefined {
  if (payment.status === PAYMENT_STATUS.PENDING_APPROVAL) {
    return at(nextStep(payment.approvals)?.role ?? ROLES.FINANCE, payment.department);
  }
  if (payment.status === PAYMENT_STATUS.PENDING_RELEASE || payment.status === PAYMENT_STATUS.FAILED) return at(ROLES.FINANCE);
  return undefined;
}

/** Text for a locked action. */
export const lockedMessage = (pending: PendingAt) => `Action locked: Process/Approval pending at ${pending.label}. Please wait until completion.`;
