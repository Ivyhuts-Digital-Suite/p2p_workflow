import type { Role } from '../types';

export interface RoleCardConfig {
  key: string;
  shortName: string;
  fullName: string;
  /** Backend roles this card signs in to */
  roles: Role[];
  guide: string;
  demoAccounts: string[];
}

export const ROLE_CARDS: RoleCardConfig[] = [
  {
    key: 'requester',
    shortName: 'Requester',
    fullName: 'Purchase Request / Business Unit',
    roles: ['REQUESTER'],
    guide: 'Raises purchase requests for what the department needs and tracks them.',
    demoAccounts: ['requester'],
  },
  {
    key: 'hod',
    shortName: 'HOD',
    fullName: 'Head of Department',
    roles: ['HOD'],
    guide: 'Checks the department budget, approves or rejects requests, and locks the funds.',
    demoAccounts: ['hod.it', 'hod.ops'],
  },
  {
    key: 'procurement',
    shortName: 'Procurement',
    fullName: 'Procurement & Sourcing Team',
    roles: ['PROCUREMENT'],
    guide: 'Floats RFQs, compares bids on price, selects the vendor and raises the PO.',
    demoAccounts: ['procurement'],
  },
  {
    key: 'vendor',
    shortName: 'Vendor',
    fullName: 'External Vendor / Supplier',
    roles: ['VENDOR'],
    guide: 'Bids on RFQs, sees awarded POs and submits invoices.',
    demoAccounts: ['vendor1', 'vendor2'],
  },
  {
    key: 'store',
    shortName: 'Store',
    fullName: 'Store / Warehouse Team',
    roles: ['STORE'],
    guide: 'Counts boxes, inspects quality and damage, and posts the Goods Receipt Note. What it accepts enters stock.',
    demoAccounts: ['store'],
  },
  {
    key: 'finance',
    shortName: 'Finance',
    fullName: 'Finance Team',
    roles: ['FINANCE'],
    guide: 'Runs the PO vs GRN vs invoice match, books the liability, verifies GSTIN, PAN and TDS, and releases the payment.',
    demoAccounts: ['finance'],
  },
  {
    key: 'auditor',
    shortName: 'Auditor',
    fullName: 'Internal & External Auditor',
    roles: ['AUDITOR'],
    guide: 'Reads every module, audit trail and compliance record. Cannot approve or pay anything.',
    demoAccounts: ['auditor'],
  },
  {
    key: 'admin',
    shortName: 'Admin',
    fullName: 'System Administrator / Owner',
    roles: ['ADMIN'],
    guide: 'Manages users, departments, budgets and approval limits, with oversight of the whole system.',
    demoAccounts: ['admin'],
  },
];

export const DEMO_PASSWORD = 'Password@123';

/** The role card an account belongs to, from its demo email prefix. */
export const cardForDemoAccount = (account: string) => ROLE_CARDS.find((c) => c.demoAccounts.includes(account));
