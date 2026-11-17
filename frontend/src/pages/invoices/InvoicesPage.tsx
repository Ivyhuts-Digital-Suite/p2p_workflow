import { FormEvent, Fragment, useState } from 'react';
import { invoiceApi } from '../../api/services';
import { askReason, Modal } from '../../components/overlays';
import { LockBanner, PriceBreakdown } from '../../components/Workflow';
import { Empty, ErrorBanner, Page, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import type { Invoice } from '../../types';
import { formatDate, formatMoney } from '../../utils/format';
import { SubmitInvoiceForm } from './SubmitInvoiceForm';

const OPEN = ['SUBMITTED', 'EXCEPTION', 'MATCHED'];
const NOTES_ALLOWED = ['SUBMITTED', 'EXCEPTION', 'MATCHED', 'BOOKED'];

function NoteDialog({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => unknown }) {
  const [type, setType] = useState<'debit' | 'credit'>('debit');
  const [taxableAmount, setTaxableAmount] = useState(0);
  const [gstAmount, setGstAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [vendorReference, setVendorReference] = useState('');
  const action = useAction(async () => {
    onClose();
    await onDone();
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(
      () => invoiceApi.addNote(invoice._id, type, { taxableAmount, gstAmount, reason, vendorReference: vendorReference || undefined }),
      `${type === 'debit' ? 'Debit' : 'Credit'} note added to ${invoice.internalRef}`,
    );
  };

  return (
    <Modal title={`Add a note to ${invoice.internalRef}`} onClose={onClose}>
      <form className="form" onSubmit={onSubmit}>
        <ErrorBanner message={action.error} onClose={action.clearError} />
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as 'debit' | 'credit')}>
            <option value="debit">Debit note (raised by us)</option>
            <option value="credit">Credit note (issued by the vendor)</option>
          </select>
        </label>
        <div className="grid-2">
          <label>
            Actual amount
            <input type="number" min={0.01} step="any" value={taxableAmount} onChange={(e) => setTaxableAmount(Number(e.target.value))} required />
          </label>
          <label>
            Tax amount
            <input type="number" min={0} step="any" value={gstAmount} onChange={(e) => setGstAmount(Number(e.target.value))} required />
          </label>
        </div>
        <p>
          <PriceBreakdown actual={taxableAmount} tax={gstAmount} total={taxableAmount + gstAmount} />
        </p>
        {type === 'credit' && (
          <label>
            Vendor's credit note number
            <input value={vendorReference} onChange={(e) => setVendorReference(e.target.value)} />
          </label>
        )}
        <label>
          Reason
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
        </label>
        <p className="muted small">This reduces what is paid on the invoice, and the base for TDS.</p>
        <div className="form-footer">
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={action.busy}>
            Add note
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function InvoicesPage() {
  const { user, hasRole } = useAuth();
  const isFinance = hasRole('FINANCE');
  const canSubmit = hasRole('FINANCE', 'VENDOR');
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [noting, setNoting] = useState<Invoice | null>(null);
  const { data, error, reload } = useApi(() => invoiceApi.list(statusFilter ? { status: statusFilter } : undefined), [statusFilter]);
  const action = useAction(reload);

  const financeActions = (inv: Invoice) => {
    const out: JSX.Element[] = [];
    if (OPEN.includes(inv.status)) {
      out.push(
        <button key="m" className="btn btn-sm" disabled={action.busy} onClick={() => void action.run(() => invoiceApi.match(inv._id), `Match re-run on ${inv.internalRef}`)}>
          Re-run match
        </button>,
        <button
          key="b"
          className="btn btn-sm btn-primary"
          disabled={action.busy || inv.status !== 'MATCHED'}
          title={inv.status !== 'MATCHED' ? 'Only a matched invoice can be booked' : ''}
          onClick={() => void action.run(() => invoiceApi.book(inv._id), `Liability booked for ${inv.internalRef}`)}
        >
          Book liability
        </button>,
        <button
          key="r"
          className="btn btn-sm btn-danger"
          disabled={action.busy}
          onClick={async () => {
            const reason = await askReason(`Reject ${inv.internalRef}`, 3, 'Reject');
            if (reason) void action.run(() => invoiceApi.reject(inv._id, reason), `${inv.internalRef} rejected`);
          }}
        >
          Reject
        </button>,
      );
    }
    if (NOTES_ALLOWED.includes(inv.status)) {
      out.push(
        <button key="n" className="btn btn-sm" disabled={action.busy} onClick={() => setNoting(inv)}>
          Add note
        </button>,
      );
    }
    return out;
  };

  const isMine = (inv: Invoice) => inv.pendingAt?.role === user?.role;

  return (
    <Page
      title={user?.role === 'VENDOR' ? 'My Invoices' : 'Finance - Invoices'}
      actions={
        <>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {['SUBMITTED', 'MATCHED', 'EXCEPTION', 'BOOKED', 'TAX_VERIFIED', 'PAID', 'REJECTED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          {canSubmit && !showForm && (
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              + Submit invoice
            </button>
          )}
        </>
      }
    >
      {showForm && (
        <Modal title="Submit invoice" onClose={() => setShowForm(false)} extraWide dismissible={false}>
          <SubmitInvoiceForm
            onCancel={() => setShowForm(false)}
            onSubmitted={() => {
              setShowForm(false);
              return reload();
            }}
          />
        </Modal>
      )}
      <ErrorBanner message={error ?? action.error} onClose={action.clearError} />
      {!data?.length ? (
        <Empty>No invoices.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Vendor inv #</th>
              <th>Vendor</th>
              <th>Items</th>
              <th>PO</th>
              <th>Date</th>
              <th className="num">Actual + Tax = Total</th>
              <th>Match</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((inv) => (
              <Fragment key={inv._id}>
                <tr>
                  <td className="mono">{inv.internalRef}</td>
                  <td>{inv.invoiceNumber}</td>
                  <td>
                    {inv.vendor?.companyName}
                    {inv.vendor?.contactPerson && <div className="muted small">{inv.vendor.contactPerson}</div>}
                  </td>
                  <td>
                    <ul className="item-list">
                      {inv.items.map((line, index) => (
                        <li key={index}>
                          <strong>{line.title?.trim() || line.description}</strong> × {line.quantity}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="mono">{inv.purchaseOrder?.poNumber}</td>
                  <td>{formatDate(inv.invoiceDate)}</td>
                  <td className="num">
                    <PriceBreakdown compact actual={inv.subtotal} tax={inv.gstAmount} total={inv.total} />
                    {!!inv.adjustments?.length && <div className="muted small">Less notes: {formatMoney(inv.adjustments.reduce((sum, n) => sum + n.total, 0))}</div>}
                  </td>
                  <td>
                    <button className="link" onClick={() => setExpanded(expanded === inv._id ? null : inv._id)}>
                      <StatusBadge status={inv.match.status} />
                      {inv.match.exceptions.length > 0 && ` (${inv.match.exceptions.length})`}
                    </button>
                  </td>
                  <td>
                    <StatusBadge status={inv.status} />
                  </td>
                  <td>
                    <div className="row-actions">{isFinance && financeActions(inv)}</div>
                    {inv.pendingAt && !isMine(inv) && user?.role !== 'ADMIN' && <LockBanner pendingAt={inv.pendingAt} />}
                  </td>
                </tr>
                {expanded === inv._id && (inv.match.exceptions.length > 0 || !!inv.adjustments?.length || inv.exceptionDecision?.reason) && (
                  <tr>
                    <td colSpan={10}>
                      {inv.match.exceptions.length > 0 && (
                        <ul className="exceptions">
                          {inv.match.exceptions.map((ex, i) => (
                            <li key={i}>
                              <strong>{ex.type.replace(/_/g, ' ')}</strong> - {ex.message}
                              {ex.expected !== undefined && (
                                <span className="muted">
                                  {' '}
                                  (expected {ex.expected}, got {ex.actual})
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {inv.exceptionDecision?.reason && <p className="small">Accepted by Finance: {inv.exceptionDecision.reason}</p>}
                      {!!inv.adjustments?.length && (
                        <ul className="grn-lines small">
                          {inv.adjustments.map((note) => (
                            <li key={note._id}>
                              <span className="mono">{note.noteNumber}</span> {note.type === 'DEBIT' ? 'Debit' : 'Credit'} note{note.vendorReference ? ` (${note.vendorReference})` : ''}:{' '}
                              <PriceBreakdown compact actual={note.taxableAmount} tax={note.gstAmount} total={note.total} /> · {note.reason}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {noting && <NoteDialog invoice={noting} onClose={() => setNoting(null)} onDone={reload} />}
    </Page>
  );
}
