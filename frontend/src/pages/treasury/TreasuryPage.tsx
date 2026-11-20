import { useState } from 'react';
import { invoiceApi, requisitionApi, sourcingApi, treasuryApi } from '../../api/services';
import { askReason } from '../../components/overlays';
import { LockBanner, PriceBreakdown } from '../../components/Workflow';
import { Card, Empty, ErrorBanner, Page, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import type { Payment } from '../../types';
import { formatDate, formatDateTime, formatMoney, productName } from '../../utils/format';

const itemsOf = (p: Payment) => p.invoice?.items?.map(productName).join(', ') || '-';
const OVERRIDABLE = ['PRICE_VARIANCE', 'TAX_RATE_MISMATCH', 'TOTAL_MISMATCH'];

export function TreasuryPage() {
  const { hasRole } = useAuth();
  const canAct = hasRole('FINANCE');
  const queue = useApi(() => treasuryApi.queue());
  const payments = useApi(() => treasuryApi.payments());
  const [sections, setSections] = useState<Record<string, string>>({});
  const [modes, setModes] = useState<Record<string, string>>({});
  const action = useAction(async () => {
    await Promise.all([queue.reload(), payments.reload()]);
  });

  const tdsSections = queue.data?.tdsSections ?? {};
  const modeFor = (id: string) => modes[id] ?? 'NEFT';
  const modeSelect = (id: string) => (
    <select value={modeFor(id)} aria-label="Payment mode" onChange={(e) => setModes((m) => ({ ...m, [id]: e.target.value }))}>
      <option>NEFT</option>
      <option>RTGS</option>
      <option>IMPS</option>
    </select>
  );

  /** A reason-backed decision: 'action' takes the reason and returns the call to make. */
  const decide = async (title: string, confirmLabel: string, minLength: number, run: (reason: string) => Promise<unknown>, done: string) => {
    const reason = await askReason(title, minLength, confirmLabel);
    if (reason) void action.run(() => run(reason), done);
  };

  return (
    <Page title="Finance">
      <ErrorBanner message={queue.error ?? payments.error ?? action.error} onClose={action.clearError} />

      {!!queue.data?.exceptions.length && (
        <Card title="Invoice exceptions">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Vendor</th>
                <th>PO</th>
                <th>Items</th>
                <th className="num">Actual + Tax = Total</th>
                <th>Exceptions</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queue.data.exceptions.map((inv) => {
                const canAccept = inv.match.exceptions.every((ex) => OVERRIDABLE.includes(ex.type));
                return (
                  <tr key={inv._id}>
                    <td>
                      <span className="mono">{inv.internalRef}</span>
                      <div className="muted small">{inv.invoiceNumber}</div>
                    </td>
                    <td>{inv.vendor?.companyName}</td>
                    <td className="mono">{inv.purchaseOrder?.poNumber}</td>
                    <td>{inv.items.map(productName).join(', ')}</td>
                    <td className="num">
                      <PriceBreakdown compact actual={inv.subtotal} tax={inv.gstAmount} total={inv.total} />
                    </td>
                    <td>
                      <ul className="exceptions small">
                        {inv.match.exceptions.map((ex, index) => (
                          <li key={index}>{ex.message}</li>
                        ))}
                      </ul>
                    </td>
                    <td>
                      {canAct && (
                        <div className="row-actions">
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={action.busy || !canAccept}
                            title={canAccept ? '' : 'Quantity, vendor and line exceptions cannot be accepted'}
                            onClick={() => void decide(`Accept the exceptions on ${inv.internalRef}`, 'Accept', 10, (r) => invoiceApi.decideException(inv._id, 'ACCEPT', r), `${inv.internalRef} accepted: it can now be booked`)}
                          >
                            Accept
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={action.busy}
                            onClick={() => void decide(`Reject ${inv.internalRef}`, 'Reject', 10, (r) => invoiceApi.decideException(inv._id, 'REJECT', r), `${inv.internalRef} rejected`)}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      {!canAccept && <LockBanner message="Waits on goods, a service sign-off or a corrected invoice, not on a decision." />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {!!queue.data?.escalations.length && (
        <Card title="Budget escalations">
          <table className="table">
            <thead>
              <tr>
                <th>RFQ</th>
                <th>Department</th>
                <th className="num">Over estimate</th>
                <th className="num">Budget shortfall</th>
                <th>Reason</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queue.data.escalations.map((rfq) => (
                <tr key={rfq._id}>
                  <td>
                    <span className="mono">{rfq.rfqNumber}</span> {rfq.title}
                  </td>
                  <td>{rfq.department?.name}</td>
                  <td className="num">{formatMoney(rfq.budgetEscalation?.overrun)}</td>
                  <td className="num">{formatMoney(rfq.budgetEscalation?.shortfall)}</td>
                  <td>{rfq.budgetEscalation?.reason}</td>
                  <td className="row-actions">
                    {canAct && (
                      <>
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={action.busy}
                          onClick={() => void action.run(() => sourcingApi.decideEscalation(rfq._id, 'APPROVE'), `Budget raised for ${rfq.rfqNumber}`)}
                        >
                          Raise budget
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={action.busy}
                          onClick={() => void decide(`Refuse the escalation on ${rfq.rfqNumber}`, 'Refuse', 3, (r) => sourcingApi.decideEscalation(rfq._id, 'REJECT', r), 'Escalation refused')}
                        >
                          Refuse
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {!!queue.data?.ratifications.length && (
        <Card title="Emergency purchases to ratify">
          <table className="table">
            <thead>
              <tr>
                <th>PR</th>
                <th>Items</th>
                <th>Why it was urgent</th>
                <th>PO</th>
                <th className="num">Actual + Tax = Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queue.data.ratifications.map((pr) => (
                <tr key={pr._id}>
                  <td>
                    <span className="mono">{pr.prNumber}</span> {pr.title}
                    <div className="muted small">
                      {pr.department?.code} · {pr.requester?.name}
                    </div>
                  </td>
                  <td>{pr.items.map(productName).join(', ')}</td>
                  <td>{pr.emergencyReason}</td>
                  <td className="mono">{pr.purchaseOrder?.poNumber ?? '-'}</td>
                  <td className="num">
                    <PriceBreakdown compact actual={pr.purchaseOrder?.subtotal} tax={pr.purchaseOrder?.taxTotal} total={pr.purchaseOrder?.grandTotal} />
                  </td>
                  <td className="row-actions">
                    {canAct && (
                      <>
                        <button className="btn btn-sm btn-primary" disabled={action.busy} onClick={() => void action.run(() => requisitionApi.ratify(pr._id, 'RATIFY'), `${pr.prNumber} ratified`)}>
                          Ratify
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={action.busy}
                          onClick={() => void decide(`Refuse to ratify ${pr.prNumber}: it cannot then be paid`, 'Refuse', 3, (r) => requisitionApi.ratify(pr._id, 'REJECT', r), `${pr.prNumber} refused`)}
                        >
                          Refuse
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title="1. Tax compliance (GST / TDS)">
        {!queue.data?.awaitingTax.length ? (
          <Empty>No booked invoices awaiting tax verification.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Vendor</th>
                <th>Items</th>
                <th>GSTIN / PAN</th>
                <th className="num">Actual + Tax = Total</th>
                <th>TDS section</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queue.data.awaitingTax.map((inv) => (
                <tr key={inv._id}>
                  <td>
                    <span className="mono">{inv.internalRef}</span>
                    <div className="muted small">{inv.invoiceNumber}</div>
                    {inv.tax && !inv.tax.verified && (
                      <ul className="exceptions small">
                        {inv.tax.issues.map((i) => (
                          <li key={i.code}>{i.message}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{inv.vendor?.companyName}</td>
                  <td>{inv.items.map(productName).join(', ')}</td>
                  <td className="mono small">
                    {inv.vendor?.gstin ?? '-'}
                    <br />
                    {inv.vendor?.pan ?? '-'}
                  </td>
                  <td className="num">
                    <PriceBreakdown compact actual={inv.subtotal} tax={inv.gstAmount} total={inv.total} />
                    {!!inv.adjustments?.length && <div className="muted small">Less notes: {formatMoney(inv.adjustments.reduce((sum, n) => sum + n.total, 0))}</div>}
                  </td>
                  <td>
                    <select
                      value={sections[inv._id] ?? inv.vendor?.tdsSection ?? 'NONE'}
                      onChange={(e) => setSections((s) => ({ ...s, [inv._id]: e.target.value }))}
                    >
                      {Object.entries(tdsSections).map(([code, s]) => (
                        <option key={code} value={code}>
                          {code} - {s.label} ({s.otherRate}%)
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {canAct && (
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={action.busy}
                        onClick={() => void action.run(() => treasuryApi.verifyTax(inv._id, sections[inv._id] ?? inv.vendor?.tdsSection), `${inv.internalRef} verified and payment staged`)}
                      >
                        Verify & stage payment
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="2. Payment release">
        {!queue.data?.awaitingRelease.length && !queue.data?.awaitingApproval.length ? (
          <Empty>No payments awaiting release.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Payment</th>
                <th>Vendor</th>
                <th>Items</th>
                <th className="num">Gross</th>
                <th className="num">TDS</th>
                <th className="num">Net payable</th>
                <th>Verified by</th>
                <th>Due</th>
                <th>Mode</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...(queue.data?.awaitingApproval ?? []), ...(queue.data?.awaitingRelease ?? [])].map((p) => {
                const locked = p.status === 'PENDING_APPROVAL';
                return (
                  <tr key={p._id}>
                    <td className="mono">{p.paymentRef}</td>
                    <td>{p.vendor?.companyName}</td>
                    <td>{itemsOf(p)}</td>
                    <td className="num">{formatMoney(p.grossAmount)}</td>
                    <td className="num">{formatMoney(p.tdsAmount)}</td>
                    <td className="num">
                      <strong>{formatMoney(p.netAmount)}</strong>
                    </td>
                    <td>{p.verifiedBy?.name}</td>
                    <td>{formatDate(p.invoice?.dueDate)}</td>
                    <td>{modeSelect(p._id)}</td>
                    <td>
                      {canAct && (
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={action.busy || locked}
                          onClick={() => void action.run(() => treasuryApi.release(p._id, modeFor(p._id)), `${p.paymentRef} sent to the bank`)}
                        >
                          Release
                        </button>
                      )}
                      {locked && <LockBanner pendingAt={p.pendingAt} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {!!queue.data?.processing.length && (
        <Card title="With the bank">
          <p className="muted small">The bank has these, or its answer never arrived. Do not pay them again another way. Check the status if no confirmation arrives.</p>
          <table className="table">
            <thead>
              <tr>
                <th>Payment</th>
                <th>Vendor</th>
                <th className="num">Net</th>
                <th>Mode</th>
                <th>Sent</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queue.data.processing.map((p) => (
                <tr key={p._id}>
                  <td className="mono">{p.paymentRef}</td>
                  <td>{p.vendor?.companyName}</td>
                  <td className="num">{formatMoney(p.netAmount)}</td>
                  <td>{p.mode}</td>
                  <td>{formatDateTime(p.releasedAt)}</td>
                  <td className="row-actions">
                    {canAct && (
                      <button className="btn btn-sm" disabled={action.busy} onClick={() => void action.run(() => treasuryApi.checkStatus(p._id), `Status of ${p.paymentRef} updated`)}>
                        Check status
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {!!queue.data?.failed.length && (
        <Card title="Failed payments">
          <table className="table">
            <thead>
              <tr>
                <th>Payment</th>
                <th>Vendor</th>
                <th className="num">Net</th>
                <th>Reason</th>
                <th className="num">Attempts</th>
                <th>Mode</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queue.data.failed.map((p) => {
                return (
                  <tr key={p._id}>
                    <td className="mono">{p.paymentRef}</td>
                    <td>{p.vendor?.companyName}</td>
                    <td className="num">{formatMoney(p.netAmount)}</td>
                    <td className="exceptions">{p.failureReason}</td>
                    <td className="num">{p.attempts ?? 0}</td>
                    <td>{modeSelect(p._id)}</td>
                    <td className="row-actions">
                      {canAct && (
                        <button className="btn btn-sm btn-primary" disabled={action.busy} onClick={() => void action.run(() => treasuryApi.retry(p._id, modeFor(p._id)), `Retrying ${p.paymentRef}`)}>
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Card title="Payment history">
        {!payments.data?.length ? (
          <Empty>No payments yet.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Payment</th>
                <th>Vendor</th>
                <th>Invoice</th>
                <th>Items</th>
                <th className="num">Actual + Tax = Total</th>
                <th className="num">Net paid</th>
                <th>Mode</th>
                <th>UTR</th>
                <th>Released</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.data.map((p) => (
                <tr key={p._id}>
                  <td className="mono">{p.paymentRef}</td>
                  <td>{p.vendor?.companyName}</td>
                  <td className="mono">{p.invoice?.internalRef}</td>
                  <td>{itemsOf(p)}</td>
                  <td className="num">
                    <PriceBreakdown compact actual={p.invoice?.subtotal} tax={p.invoice?.gstAmount} total={p.invoice?.total} />
                  </td>
                  <td className="num">{formatMoney(p.netAmount)}</td>
                  <td>{p.mode ?? '-'}</td>
                  <td className="mono small">
                    {p.utr ?? '-'}
                    {p.simulated && <div><span className="badge badge-amber">SIMULATED</span></div>}
                  </td>
                  <td>{formatDateTime(p.releasedAt)}</td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
