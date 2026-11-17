import { Fragment, useEffect, useState } from 'react';
import { sourcingApi } from '../../api/services';
import { Link, useSearchParams } from 'react-router-dom';
import { confirmAction } from '../../components/overlays';
import { PriceBreakdown } from '../../components/Workflow';
import { Empty, ErrorBanner, Page, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import { formatDateTime, formatMoney, productName } from '../../utils/format';
import { RfqBidsPanel } from './RfqBidsPanel';

export function SourcingPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole('PROCUREMENT');
  const [params] = useSearchParams();
  // Opened from a PR's "View RFQ": that RFQ starts expanded and is scrolled into view.
  const focusId = params.get('rfq');
  const [expanded, setExpanded] = useState<string | null>(focusId);
  const { data, error, reload } = useApi(() => sourcingApi.listRfqs());
  const action = useAction(reload);
  const focusMissing = !!focusId && !!data && !data.some((r) => r._id === focusId);

  useEffect(() => {
    if (!focusId || !data?.some((r) => r._id === focusId)) return;
    setExpanded(focusId);
    document.getElementById(`rfq-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusId, data]);

  return (
    <Page
      title="RFQs & Tenders"
      actions={
        canManage && (
          <Link className="btn" to="/requisitions">
            Initiate an RFQ from a requisition
          </Link>
        )
      }
    >
      <ErrorBanner message={error ?? action.error} onClose={action.clearError} />
      {focusMissing && <div className="alert alert-info">The RFQ for that requisition could not be found. It may have been cancelled.</div>}
      {!data?.length ? (
        <Empty>No RFQs yet. Initiate one from an approved PR under Requisitions.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>RFQ #</th>
              <th>Title</th>
              <th>Items</th>
              <th className="num">Estimate</th>
              <th>Awarded vendor</th>
              <th className="num">Actual + Tax = Total</th>
              <th>Closes</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((rfq) => (
              <Fragment key={rfq._id}>
                <tr id={`rfq-${rfq._id}`} className={rfq._id === focusId ? 'highlight' : ''}>
                  <td className="mono">
                    {rfq.rfqNumber}
                    {rfq.isEmergency && <div><span className="badge badge-red">EMERGENCY</span></div>}
                  </td>
                  <td>
                    {rfq.title}
                    {rfq.technicalEvaluation && <div className="muted small">Two-envelope</div>}
                  </td>
                  <td>
                    <ul className="item-list">
                      {rfq.items.map((i) => (
                        <li key={i._id} title={i.description}>
                          <strong>{productName(i)}</strong> × {i.quantity} {i.uom}
                          {i.title && <div className="muted small">{i.description}</div>}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="num">{formatMoney(rfq.budgetEstimate)}</td>
                  <td>
                    {rfq.awardedBid?.vendor?.companyName ?? '-'}
                    {rfq.awardedBid?.vendor?.contactPerson && <div className="muted small">{rfq.awardedBid.vendor.contactPerson}</div>}
                  </td>
                  <td className="num">{rfq.awardedBid ? <PriceBreakdown compact actual={rfq.awardedBid.totalAmount} tax={rfq.awardedBid.taxAmount} total={rfq.awardedBid.grandTotal} /> : '-'}</td>
                  <td>{formatDateTime(rfq.closeAt)}</td>
                  <td>
                    <StatusBadge status={rfq.status} />
                  </td>
                  <td className="row-actions">
                    {canManage && rfq.status === 'DRAFT' && (
                      <button className="btn btn-sm btn-primary" onClick={() => void action.run(() => sourcingApi.publish(rfq._id), `${rfq.rfqNumber} published`)}>
                        Publish
                      </button>
                    )}
                    {canManage && rfq.status === 'PUBLISHED' && (
                      <button className="btn btn-sm" onClick={() => void action.run(() => sourcingApi.close(rfq._id), `Bidding closed on ${rfq.rfqNumber}`)}>
                        Close bidding
                      </button>
                    )}
                    {canManage && ['DRAFT', 'PUBLISHED', 'CLOSED'].includes(rfq.status) && (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={async () => {
                          if (await confirmAction(`Cancel ${rfq.rfqNumber}?`, 'Its requisitions return to the approved pool.', 'Cancel RFQ')) {
                            void action.run(() => sourcingApi.cancel(rfq._id), `${rfq.rfqNumber} cancelled`);
                          }
                        }}
                      >
                        Cancel
                      </button>
                    )}
                    {rfq.status !== 'DRAFT' && (
                      <button className="btn btn-sm" onClick={() => setExpanded(expanded === rfq._id ? null : rfq._id)}>
                        {expanded === rfq._id ? 'Hide bids' : 'Bids'}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === rfq._id && (
                  <tr>
                    <td colSpan={9}>
                      <RfqBidsPanel rfq={rfq} onChange={reload} />
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
