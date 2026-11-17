const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

export const formatMoney = (n?: number | null) => (n === undefined || n === null ? '-' : inr.format(n));

export const formatDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

export const formatDateTime = (d?: string) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 07-Nov-2026, 10:30 AM: the same shape everywhere it is used, whatever the browser locale. */
export function formatStamp(d?: string) {
  if (!d) return '-';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  const hours = date.getHours();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}-${MONTHS[date.getMonth()]}-${date.getFullYear()}, ${pad(hours % 12 || 12)}:${pad(date.getMinutes())} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** The product as it should be read: its title, or the description on older lines that have none. */
export const productName = (item: { title?: string; description: string }) => item.title?.trim() || item.description;

/**
 * A GRN's PO option: PO Number | PO Title | Vendor Name | Company Name | Product | Description | Date and time.
 * Missing parts read as "-"; several lines show the first with a count.
 */
export function grnPoLabel(po: {
  poNumber: string;
  rfq?: { title?: string };
  vendor?: { contactPerson?: string; companyName?: string };
  items: { title?: string; description: string }[];
  createdAt?: string;
}) {
  const first = po.items[0];
  const more = po.items.length > 1 ? ` +${po.items.length - 1} more` : '';
  return [
    po.poNumber,
    po.rfq?.title || '-',
    po.vendor?.contactPerson || '-',
    po.vendor?.companyName || '-',
    first ? `${productName(first)}${more}` : 'No items',
    first?.description || '-',
    formatStamp(po.createdAt),
  ].join(' | ');
}

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
