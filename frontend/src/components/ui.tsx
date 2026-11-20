import { ReactNode } from 'react';

const STATUS_TONE: Record<string, string> = {
  APPROVED: 'green',
  ACCEPTED: 'green',
  MATCHED: 'green',
  AWARDED: 'green',
  RELEASED: 'green',
  PAID: 'green',
  RECEIVED: 'green',
  VERIFIED: 'green',
  RATIFIED: 'green',
  LIVE: 'blue',
  PUBLISHED: 'blue',
  SUBMITTED: 'blue',
  ISSUED: 'blue',
  ACKNOWLEDGED: 'blue',
  BOOKED: 'blue',
  TAX_VERIFIED: 'blue',
  SOURCING: 'blue',
  PO_CREATED: 'blue',
  PROCESSING: 'blue',
  DISPATCHED: 'blue',
  RAISED: 'blue',
  PENDING: 'amber',
  PENDING_APPROVAL: 'amber',
  PENDING_RELEASE: 'amber',
  PARTIALLY_RECEIVED: 'amber',
  PARTIALLY_ACCEPTED: 'amber',
  AWAITING_CLOSE: 'amber',
  PARTIALLY_RELEASED: 'amber',
  CLOSED: 'grey',
  SHORT_CLOSED: 'grey',
  DRAFT: 'grey',
  WITHDRAWN: 'grey',
  REJECTED: 'red',
  CANCELLED: 'red',
  EXCEPTION: 'red',
  FAILED: 'red',
  BLACKLISTED: 'red',
  SUSPENDED: 'red',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${STATUS_TONE[status] ?? 'grey'}`}>{status.replace(/_/g, ' ')}</span>;
}

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <header className="page-header">
        <h1>{title}</h1>
        <div className="page-actions">{actions}</div>
      </header>
      {children}
    </div>
  );
}

export function ErrorBanner({ message, onClose }: { message?: string | null; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div className="alert alert-error" role="alert">
      <span>{message}</span>
      {onClose && (
        <button className="link" onClick={onClose} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted empty">{children}</p>;
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

