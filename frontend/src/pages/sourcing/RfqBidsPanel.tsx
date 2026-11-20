import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorDetails, errorMessage } from '../../api/client';
import { poApi, sourcingApi } from '../../api/services';
import { Modal, toast } from '../../components/overlays';
import { LockBanner, PriceBreakdown } from '../../components/Workflow';
import { Empty, ErrorBanner, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import type { Bid, BudgetCheck, Rfq } from '../../types';
import { formatDateTime, formatMoney } from '../../utils/format';

const lineName = (line: { title?: string; description?: string }) => line.title?.trim() || line.description || '-';

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
  const biddingOpen = rfq.status === 'PUBLISHED' && new Date(rfq.closeAt) > new Date();
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
      else if (result.po?.status === 'PENDING_APPROVAL') {
        const next = result.po.approvals.find((a) => a.status === 'PENDING');
        toast(`${bid.vendor.companyName} selected. ${result.po.poNumber} generated; it is above your authority, so it is waiting for ${next?.role ?? 'approval'}.`);
      } else toast(`${bid.vendor.companyName} selected. ${result.po?.poNumber} generated, approved and issued to the vendor.`);
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
    <Modal title={biddingOpen ? `Close bidding and select ${bid.vendor.companyName}` : `Select ${bid.vendor.companyName}`} onClose={onClose}>
      <form className="form" onSubmit={onSubmit}>
        <ErrorBanner message={error} onClose={() => setError(null)} />
        <ul className="item-list">
          {bid.items.map((line) => (
            <li key={line.rfqItem}>
              <strong>{lineName(line)}</strong> × {line.quantity} {line.uom}
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
        {biddingOpen && (
          <div className="alert alert-warning">
            <span>Bidding is open until {formatDateTime(rfq.closeAt)}. Confirming closes bidding for all vendors and awards {bid.vendor.companyName} immediately.</span>
          </div>
        )}
        <p className="muted small">Selecting this vendor generates the purchase order. Within your DoA authority it is approved and issued at once; above it, it goes to the HOD or Finance.</p>
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
              {budget ? 'Accept the overrun and select' : biddingOpen ? 'Close Bid & Select Vendor' : 'Select vendor'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

/**
 * The comparison sheet for an RFQ: every bid and its prices from the moment it is submitted, ranked by
 * lowest price, with "Select vendor" on each live bid. Vendors never see this sheet or each other's bids.
 */
export function RfqBidsPanel({ rfq, onChange }: { rfq: Rfq; onChange: () => unknown }) {
  const { hasRole } = useAuth();
  const canManage = hasRole('PROCUREMENT');
  const { data: bids, error, reload } = useApi(() => sourcingApi.bids(rfq._id), [rfq._id, rfq.status]);
  const [awarding, setAwarding] = useState<Bid | null>(null);
  const refresh = async () => {
    await reload();
    await onChange();
  };
  const action = useAction(refresh);

  const biddingLive = rfq.status === 'PUBLISHED' && new Date(rfq.closeAt) > new Date();
  // Any live bid can be selected, during bidding or after it closes.
  const canAward = canManage && (rfq.status === 'PUBLISHED' || rfq.status === 'CLOSED');

  // New bids appear without a reload while bidding is live.
  useEffect(() => {
    if (!biddingLive) return;
    const timer = window.setInterval(() => void reload(), 15_000);
    return () => window.clearInterval(timer);
  }, [biddingLive, reload]);

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
      <p className="muted small">
        Bids are ranked by lowest pre-tax price{biddingLive ? ' and refresh while bidding is open' : ''}. Choosing a vendor other than L1 needs a written justification, kept in the audit trail.
      </p>
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
                        <strong>{lineName(line)}</strong> × {line.quantity} {line.uom}
                        <span className="muted">
                          {' '}
                          @ {formatMoney(line.unitPrice)} + {line.taxRate}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="num">
                  <PriceBreakdown compact actual={bid.totalAmount} tax={bid.taxAmount} total={bid.grandTotal} />
                </td>
                <td>{bid.deliveryDays} days</td>
                <td className="num">{bid.priceScore ?? '-'}</td>
                <td>
                  {formatDateTime(bid.submittedAt)}
                  {bid.revision > 1 && <span className="muted small"> (rev {bid.revision})</span>}
                </td>
                <td>
                  <StatusBadge status={bid.status} />
                </td>
                <td className="row-actions">
                  {canAward && bid.status === 'SUBMITTED' && (
                    <button className="btn btn-sm btn-primary" disabled={action.busy} onClick={() => setAwarding(bid)}>
                      {biddingLive ? 'Close Bid & Select Vendor' : 'Select vendor'}
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
