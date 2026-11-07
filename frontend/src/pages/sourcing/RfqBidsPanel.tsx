import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorDetails, errorMessage } from '../../api/client';
import { poApi, sourcingApi } from '../../api/services';
import { askReason, Modal, toast } from '../../components/overlays';
import { LockBanner, PriceBreakdown } from '../../components/Workflow';
import { Empty, ErrorBanner, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import type { Bid, BudgetCheck, Rfq } from '../../types';
import { formatDateTime, formatMoney } from '../../utils/format';

const GST_RATES = [0, 5, 12, 18, 28];

/** Confirms a vendor selection inline: the price, any justification, and any budget overrun. */
function AwardDialog({ rfq, bid, onClose, onDone }: { rfq: Rfq; bid: Bid; onClose: () => void; onDone: () => unknown }) {
  const quotedRate = bid.items[0]?.taxRate ?? 18;
  const uniformRate = bid.items.every((i) => i.taxRate === quotedRate);
  const [rate, setRate] = useState<number | 'quoted'>('quoted');
  const [justification, setJustification] = useState('');
  const [overrunReason, setOverrunReason] = useState('');
  const [escalationReason, setEscalationReason] = useState('');
  const [budget, setBudget] = useState<BudgetCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isL1 = bid.rank === 1;
  const taxAmount = rate === 'quoted' ? bid.taxAmount ?? 0 : Math.round(bid.totalAmount * rate) / 100;
  const total = bid.totalAmount + taxAmount;
  const exceeded = budget?.code === 'BUDGET_EXCEEDED';
  const pendingWithFinance = rfq.budgetEscalation?.status === 'PENDING';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await sourcingApi.award(rfq._id, {
        bidId: bid._id,
        taxRate: rate === 'quoted' ? undefined : rate,
        justification: isL1 ? undefined : justification,
        overrunReason: overrunReason || undefined,
      });
      if (result.poError) setError(result.poError);
      else toast(`${bid.vendor.companyName} selected. ${result.po?.poNumber} created and sent for approval.`);
      await onDone();
      if (!result.poError) onClose();
    } catch (err) {
      const details = errorDetails<BudgetCheck>(err);
      if (details?.code === 'BUDGET_OVERRUN' || details?.code === 'BUDGET_EXCEEDED') setBudget(details);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const escalate = async () => {
    setBusy(true);
    setError(null);
    try {
      await sourcingApi.escalateBudget(rfq._id, bid._id, escalationReason);
      toast('Sent to Finance. You can select this vendor once they approve the extra budget.');
      await onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Select ${bid.vendor.companyName}`} onClose={onClose}>
      <form className="form" onSubmit={onSubmit}>
        <ErrorBanner message={error} onClose={() => setError(null)} />
        <ul className="item-list">
          {bid.items.map((line) => (
            <li key={line.rfqItem}>
              {line.description} × {line.quantity} {line.uom}
            </li>
          ))}
        </ul>
        <p>
          <PriceBreakdown actual={bid.totalAmount} tax={taxAmount} total={total} />
        </p>
        <label>
          GST on the purchase order
          <select value={rate} onChange={(e) => setRate(e.target.value === 'quoted' ? 'quoted' : Number(e.target.value))}>
            <option value="quoted">As quoted{uniformRate ? ` (${quotedRate}%)` : ''}</option>
            {GST_RATES.map((r) => (
              <option key={r} value={r}>
                {r}%
              </option>
            ))}
          </select>
        </label>
        {!isL1 && (
          <label>
            This vendor is L{bid.rank}, not L1. Written justification *
            <textarea rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} required minLength={10} />
          </label>
        )}
        {budget && (
          <div className="alert alert-warning">
            <div>
              <strong>This quote is {formatMoney(budget.overrun)} over the requisition estimate of {formatMoney(budget.estimate)}.</strong>
              <div className="small">
                {budget.department} has {formatMoney(budget.available)} left{exceeded ? `, so it is short by ${formatMoney(budget.shortfall)}` : ''}.
              </div>
            </div>
          </div>
        )}
        {budget && !exceeded && (
          <label>
            Reason for going over the estimate *
            <textarea rows={2} value={overrunReason} onChange={(e) => setOverrunReason(e.target.value)} required minLength={10} />
          </label>
        )}
        {exceeded && (pendingWithFinance ? (
          <LockBanner message="Action locked: a budget escalation is pending at Finance. Please wait until completion." />
        ) : (
          <label>
            Reason for asking Finance for more budget *
            <textarea rows={2} value={escalationReason} onChange={(e) => setEscalationReason(e.target.value)} minLength={10} />
          </label>
        ))}
        <p className="muted small">Selecting this vendor generates the purchase order and sends it for approval.</p>
        <div className="form-footer">
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {exceeded ? (
            <button type="button" className="btn btn-primary" disabled={busy || pendingWithFinance || escalationReason.trim().length < 10} onClick={() => void escalate()}>
              Escalate to Finance
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy}>
              {budget ? 'Accept the overrun and select' : 'Select vendor'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

/**
 * The comparison sheet for an RFQ. On a two-envelope tender Procurement reviews each bid first, with
 * prices sealed, then opens the financials: only qualified bids are ranked and can be selected.
 */
export function RfqBidsPanel({ rfq, onChange }: { rfq: Rfq; onChange: () => unknown }) {
  const { hasRole } = useAuth();
  const canManage = hasRole('PROCUREMENT');
  const { data: bids, error, reload } = useApi(() => sourcingApi.bids(rfq._id), [rfq._id, rfq.status, rfq.financialsOpenedAt]);
  const [awarding, setAwarding] = useState<Bid | null>(null);
  const refresh = async () => {
    await reload();
    await onChange();
  };
  const action = useAction(refresh);

  const biddingEnded = rfq.status === 'CLOSED' || (rfq.status === 'PUBLISHED' && new Date(rfq.closeAt) <= new Date());
  const sealed = !!rfq.technicalEvaluation && !rfq.financialsOpenedAt;
  const canAward = canManage && biddingEnded && !sealed;
  const canReview = canManage && biddingEnded && !rfq.financialsOpenedAt;
  const live = bids?.filter((b) => b.status === 'SUBMITTED') ?? [];
  const unreviewed = live.filter((b) => b.technicalStatus === 'PENDING').length;

  const review = async (bid: Bid, result: 'QUALIFIED' | 'DISQUALIFIED') => {
    const remarks = result === 'DISQUALIFIED' ? await askReason(`Disqualify ${bid.vendor.companyName}`, 3, 'Disqualify') : undefined;
    if (remarks === null) return;
    void action.run(() => sourcingApi.technicalReview(bid._id, { result, remarks }), `${bid.vendor.companyName} ${result === 'QUALIFIED' ? 'qualified' : 'disqualified'}`);
  };

  return (
    <div className="panel">
      <ErrorBanner message={error ?? action.error} onClose={action.clearError} />
      {rfq.purchaseOrder && (
        <div className="alert alert-info">
          <span>
            Purchase order <strong className="mono">{rfq.purchaseOrder.poNumber}</strong> <StatusBadge status={rfq.purchaseOrder.status} />
          </span>
          <Link to="/purchase-orders">View purchase orders</Link>
        </div>
      )}
      {rfq.budgetEscalation?.status === 'PENDING' && <LockBanner message="Action locked: a budget escalation is pending at Finance. Please wait until completion." />}
      {rfq.budgetEscalation?.status === 'REJECTED' && <div className="alert alert-error">Finance refused the budget escalation: {rfq.budgetEscalation.remarks}</div>}
      {sealed && (
        <div className="alert alert-info">
          <span>
            Two-envelope tender: prices stay sealed until every bid has a technical review.
            {biddingEnded && unreviewed > 0 ? ` ${unreviewed} still to review.` : ''}
          </span>
          {canManage && biddingEnded && (
            <button className="btn btn-sm btn-primary" disabled={action.busy || unreviewed > 0} onClick={() => void action.run(() => sourcingApi.openFinancials(rfq._id), 'Financials opened. Qualified bids are now ranked.')}>
              Open financials
            </button>
          )}
        </div>
      )}
      {!sealed && (
        <p className="muted small">
          Bids are ranked by lowest pre-tax price, and only technically qualified bids are ranked. Choosing a vendor other than L1 needs a written justification, kept in the audit trail.
        </p>
      )}
      {!bids?.length ? (
        <Empty>No bids yet.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Vendor</th>
              <th>Items quoted</th>
              <th className="num">Actual + Tax = Total</th>
              <th>Delivery</th>
              <th className="num">% of L1 price</th>
              <th>Technical</th>
              <th>Submitted</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bids.map((bid) => (
              <tr key={bid._id} className={bid.rank === 1 ? 'highlight' : ''}>
                <td>
                  <strong>{bid.rank ? `L${bid.rank}` : '-'}</strong>
                </td>
                <td>
                  {bid.vendor.companyName}
                  {bid.vendor.contactPerson && <div className="muted small">{bid.vendor.contactPerson}</div>}
                </td>
                <td>
                  <ul className="item-list">
                    {bid.items.map((line) => (
                      <li key={line.rfqItem}>
                        {line.description} × {line.quantity} {line.uom}
                        {!bid.pricesSealed && (
                          <span className="muted">
                            {' '}
                            @ {formatMoney(line.unitPrice)} + {line.taxRate}%
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="num">{bid.pricesSealed ? <span className="muted">Sealed</span> : <PriceBreakdown compact actual={bid.totalAmount} tax={bid.taxAmount} total={bid.grandTotal} />}</td>
                <td>{bid.deliveryDays} days</td>
                <td className="num">{bid.priceScore ?? '-'}</td>
                <td>
                  <StatusBadge status={bid.technicalStatus ?? 'PENDING'} />
                  {bid.technicalRemarks && <div className="muted small">{bid.technicalRemarks}</div>}
                  {canReview && bid.status === 'SUBMITTED' && (
                    <div className="row-actions">
                      <button className="btn btn-sm" disabled={action.busy} onClick={() => void review(bid, 'QUALIFIED')}>
                        Qualify
                      </button>
                      <button className="btn btn-sm btn-danger" disabled={action.busy} onClick={() => void review(bid, 'DISQUALIFIED')}>
                        Disqualify
                      </button>
                    </div>
                  )}
                </td>
                <td>
                  {formatDateTime(bid.submittedAt)}
                  {bid.revision > 1 && <span className="muted small"> (rev {bid.revision})</span>}
                </td>
                <td>
                  <StatusBadge status={bid.status} />
                </td>
                <td className="row-actions">
                  {canAward && bid.status === 'SUBMITTED' && bid.technicalStatus !== 'DISQUALIFIED' && (
                    <button className="btn btn-sm btn-primary" disabled={action.busy} onClick={() => setAwarding(bid)}>
                      Select vendor
                    </button>
                  )}
                  {canManage && bid.status === 'AWARDED' && !rfq.purchaseOrder && (
                    <button className="btn btn-sm btn-primary" disabled={action.busy} onClick={() => void action.run(() => poApi.createFromBid(bid._id), 'Purchase order created')}>
                      Create PO
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {awarding && <AwardDialog rfq={rfq} bid={awarding} onClose={() => setAwarding(null)} onDone={refresh} />}
    </div>
  );
}
