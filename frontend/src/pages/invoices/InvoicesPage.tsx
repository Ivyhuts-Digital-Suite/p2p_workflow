import { Fragment, useState } from 'react';
import { invoiceApi } from '../../api/services';
import { askReason, Modal } from '../../components/overlays';
import { LockBanner, PriceBreakdown } from '../../components/Workflow';
import { Empty, ErrorBanner, Page, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import type { Invoice } from '../../types';
import { formatDate, formatMoney, productName } from '../../utils/format';
import { SubmitInvoiceForm } from './SubmitInvoiceForm';

const OPEN = ['SUBMITTED', 'EXCEPTION', 'MATCHED'];

export function InvoicesPage() {
  const { user, hasRole } = useAuth();
  const isFinance = hasRole('FINANCE');
  // Vendors submit invoices from each PO on Purchase Orders; Finance still keys paper invoices here.
  const canSubmit = hasRole('FINANCE');
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, error, reload } = useApi(() => invoiceApi.list(statusFilter ? { status: statusFilter } : undefined), [statusFilter]);
  const action = useAction(reload);

  const financeActions = (inv: Invoice) => {
    const out: JSX.Element[] = [];
    if (OPEN.includes(inv.status)) {
      out.push(
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
                          <strong>{productName(line)}</strong> × {line.quantity}
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
    </Page>
  );
}
