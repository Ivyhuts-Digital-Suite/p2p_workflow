import type { Role } from '../types';

export interface NavItem {
  path: string;
  label: string;
  roles: Role[];
  /** Vendor portal screens: an Admin has no vendor profile to show, so they stay hidden */
  vendorOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Dashboard', roles: ['REQUESTER', 'HOD', 'PROCUREMENT', 'STORE', 'FINANCE', 'AUDITOR', 'VENDOR'] },
  { path: '/requisitions', label: 'Requisitions', roles: ['REQUESTER', 'HOD', 'PROCUREMENT', 'FINANCE', 'AUDITOR'] },
  { path: '/vendors', label: 'Vendors', roles: ['PROCUREMENT', 'AUDITOR'] },
  { path: '/sourcing', label: 'RFQs & Bids', roles: ['PROCUREMENT', 'AUDITOR'] },
  { path: '/bidding-dashboard', label: 'Bidding Dashboard', roles: ['PROCUREMENT', 'AUDITOR'] },
  { path: '/vendor/rfqs', label: 'Open RFQs', roles: ['VENDOR'], vendorOnly: true },
  { path: '/purchase-orders', label: 'Purchase Orders', roles: ['REQUESTER', 'HOD', 'PROCUREMENT', 'STORE', 'FINANCE', 'AUDITOR', 'VENDOR'] },
  { path: '/grn', label: 'Goods Receipt', roles: ['STORE', 'AUDITOR'] },
  { path: '/service-entries', label: 'Service Sign-off', roles: ['REQUESTER', 'HOD', 'STORE', 'PROCUREMENT', 'AUDITOR', 'VENDOR'] },
  { path: '/invoices', label: 'Invoices', roles: ['FINANCE', 'AUDITOR', 'VENDOR'] },
  { path: '/treasury', label: 'Finance', roles: ['FINANCE', 'AUDITOR'] },
  { path: '/vendor/profile', label: 'Company Profile', roles: ['VENDOR'], vendorOnly: true },
  { path: '/audit', label: 'Audit & Compliance', roles: ['AUDITOR'] },
  { path: '/admin', label: 'Administration', roles: ['ADMIN', 'AUDITOR'] },
];

/** ADMIN sees every module except the vendor's own screens. */
export const navItemsFor = (role: Role) =>
  NAV_ITEMS.filter((item) => item.roles.includes(role) || (role === 'ADMIN' && !item.vendorOnly));

export const ROLE_LABELS: Record<Role, string> = {
  REQUESTER: 'Purchase Request / Business Unit',
  HOD: 'Head of Department',
  PROCUREMENT: 'Procurement & Sourcing Team',
  STORE: 'Store / Warehouse Team',
  FINANCE: 'Finance Team',
  AUDITOR: 'Internal & External Auditor',
  VENDOR: 'External Vendor / Supplier',
  ADMIN: 'System Administrator / Owner',
};
