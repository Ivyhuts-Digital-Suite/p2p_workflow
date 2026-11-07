const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

export const formatMoney = (n?: number | null) => (n === undefined || n === null ? '-' : inr.format(n));

export const formatDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

export const formatDateTime = (d?: string) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

/** PO Number | Vendor Name | Company Name | Product/Item Name | Date/Time Stamp */
export function poLabel(po: { poNumber: string; vendor?: { contactPerson?: string; companyName?: string }; items: { description: string }[]; createdAt?: string }) {
  const first = po.items[0]?.description ?? 'No items';
  const items = po.items.length > 1 ? `${first} +${po.items.length - 1} more` : first;
  return [po.poNumber, po.vendor?.contactPerson ?? '-', po.vendor?.companyName ?? '-', items, formatDateTime(po.createdAt)].join(' | ');
}

export function formatDuration(ms: number) {
  if (ms <= 0) return 'closed';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
}
