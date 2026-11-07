export const ROLES = {
  /** Requester / end user raising purchase requisitions */
  REQUESTER: 'REQUESTER',
  /** Department head - approves, cancels and deactivates department PRs */
  HOD: 'HOD',
  PROCUREMENT: 'PROCUREMENT',
  /** Store / warehouse team - goods receipt, quality inspection at receipt, inventory and returns */
  STORE: 'STORE',
  /** Finance - invoice 3-way matching, liability booking, tax compliance, payment release and high-value PO approval */
  FINANCE: 'FINANCE',
  /** Internal & external auditor - read-only oversight of every module */
  AUDITOR: 'AUDITOR',
  /** External vendor portal user */
  VENDOR: 'VENDOR',
  /** System administrator - bypasses role checks */
  ADMIN: 'ADMIN',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES = Object.values(ROLES) as Role[];
export const INTERNAL_ROLES = ALL_ROLES.filter((r) => r !== ROLES.VENDOR);

/** Single Master Account Policy: at most one account company-wide (enforced by a unique index on User). */
export const MASTER_ROLES: Role[] = [ROLES.ADMIN, ROLES.AUDITOR, ROLES.FINANCE, ROLES.STORE];

/** Roles tied to a department. HOD is the master account of its department: one per department. */
export const DEPARTMENT_ROLES: Role[] = [ROLES.REQUESTER, ROLES.HOD];
