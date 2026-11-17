import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { sourcingApi, vendorApi } from '../../api/services';
import { LockBanner, PriceBreakdown } from '../../components/Workflow';
import { Card, Empty, ErrorBanner, Page, StatusBadge } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import { LICENCE_LABELS } from '../../types';
import type { Rfq, Vendor } from '../../types';
import { formatDateTime } from '../../utils/format';

const GST_RATES = [0, 5, 12, 18, 28];

/** Why this vendor cannot bid on this RFQ, using the same rule the server enforces. */
function licenceBlock(rfq: Rfq, vendor: Vendor | null) {
  if (!vendor) return null;
  const now = Date.now();
  const documents = (vendor.documents ?? []).filter((d) => d.status !== 'REJECTED');
  const isCurrent = (d: { expiryDate: string }) => new Date(d.expiryDate).getTime() > now;
  const expiredType = [...new Set(documents.map((d) => d.type))].find((type) => !documents.some((d) => d.type === type && isCurrent(d)));
  if (expiredType) return `Action locked: your ${LICENCE_LABELS[expiredType]?.toLowerCase()} has expired. Add the renewal under Company Profile.`;
  const missing = rfq.requiredLicences?.find((type) => !documents.some((d) => d.type === type && d.status === 'VERIFIED' && isCurrent(d)));
  if (!missing) return null;
  return documents.some((d) => d.type === missing && isCurrent(d))
    ? `Action locked: verification of your ${LICENCE_LABELS[missing]?.toLowerCase()} is pending at Procurement. Please wait until completion.`
    : `Action locked: this RFQ needs a verified ${LICENCE_LABELS[missing]?.toLowerCase()}. Add it under Company Profile.`;
}

function BidForm({ rfq, vendor }: { rfq: Rfq; vendor: Vendor | null }) {
  const mine = useApi(() => sourcingApi.myBid(rfq._id), [rfq._id]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [taxRates, setTaxRates] = useState<Record<string, number>>({});
  const [deliveryDays, setDeliveryDays] = useState(14);
  const action = useAction(mine.reload);

  const isOpen = rfq.status === 'PUBLISHED' && new Date(rfq.closeAt) > new Date();
  const block = isOpen ? licenceBlock(rfq, vendor) : null;
  const existing = mine.data?.bid;
  const priceFor = (itemId: string) =>
    prices[itemId] ?? existing?.items.find((i) => i.rfqItem === itemId)?.unitPrice ?? 0;
  const taxFor = (itemId: string) =>
    taxRates[itemId] ?? existing?.items.find((i) => i.rfqItem === itemId)?.taxRate ?? 18;
  const actual = rfq.items.reduce((s, i) => s + i.quantity * priceFor(i._id), 0);
  const tax = rfq.items.reduce((s, i) => s + (i.quantity * priceFor(i._id) * taxFor(i._id)) / 100, 0);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(
      () =>
        sourcingApi.submitBid(rfq._id, {
          items: rfq.items.map((i) => ({ rfqItemId: i._id, unitPrice: priceFor(i._id), taxRate: taxFor(i._id) })),
          deliveryDays,
        }),
      existing ? 'Bid revised' : 'Bid submitted',
    );
  };

  return (
    <form onSubmit={onSubmit} className="form">
      <ErrorBanner message={mine.error ?? action.error} onClose={action.clearError} />
      {block && <LockBanner message={block} />}
      {existing && (
        <p>
          Your bid: <StatusBadge status={existing.status} /> <PriceBreakdown compact actual={existing.totalAmount} tax={existing.taxAmount} total={existing.grandTotal} /> · revision {existing.revision}
          {existing.rank && existing.status === 'SUBMITTED' ? (
            <>
              {' '}
              · current rank <strong>#{existing.rank}</strong> of {mine.data?.totalBids}
            </>
          ) : null}
        </p>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Unit price (pre-tax)</th>
            <th>GST %</th>
            <th className="num">Actual + Tax = Total</th>
          </tr>
        </thead>
        <tbody>
          {rfq.items.map((item) => {
            const lineActual = item.quantity * priceFor(item._id);
            const lineTax = (lineActual * taxFor(item._id)) / 100;
            return (
              <tr key={item._id}>
                <td>
                  {item.title || item.description}
                  {item.title && <div className="muted small">{item.description}</div>}
                  {item.specifications && <div className="muted small">{item.specifications}</div>}
                </td>
                <td>
                  {item.quantity} {item.uom}
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    disabled={!isOpen || !!block}
                    value={priceFor(item._id)}
                    onChange={(e) => setPrices((p) => ({ ...p, [item._id]: Number(e.target.value) }))}
                  />
                </td>
                <td>
                  <select disabled={!isOpen || !!block} value={taxFor(item._id)} onChange={(e) => setTaxRates((r) => ({ ...r, [item._id]: Number(e.target.value) }))}>
                    {GST_RATES.map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num">
                  <PriceBreakdown compact actual={lineActual} tax={lineTax} total={lineActual + lineTax} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {isOpen && (
        <div className="form-footer">
          <label className="inline">
            Delivery (days)
            <input type="number" min={0} className="narrow" value={deliveryDays} disabled={!!block} onChange={(e) => setDeliveryDays(Number(e.target.value))} />
          </label>
          <PriceBreakdown actual={actual} tax={tax} total={actual + tax} />
          <div className="spacer" />
          {existing?.status === 'SUBMITTED' && (
            <button type="button" className="btn btn-danger" onClick={() => void action.run(() => sourcingApi.withdrawBid(existing._id), 'Bid withdrawn')}>
              Withdraw
            </button>
          )}
          <button className="btn btn-primary" disabled={action.busy || !!block}>
            {existing ? 'Revise bid' : 'Submit bid'}
          </button>
        </div>
      )}
    </form>
  );
}

export function VendorRfqsPage() {
  const { data, error } = useApi(() => sourcingApi.listRfqs());
  const profile = useApi(() => vendorApi.me());
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Page title="RFQs open to you">
      <ErrorBanner message={error} />
      {!data?.length && <Empty>No RFQs available. Bidding requires an approved vendor profile.</Empty>}
      {data?.map((rfq) => (
        <Card key={rfq._id}>
          <div className="card-head">
            <div>
              <span className="mono small">{rfq.rfqNumber}</span> <strong>{rfq.title}</strong>
              <div className="muted small">
                {rfq.items.map((i) => `${i.title?.trim() || i.description} × ${i.quantity} ${i.uom}`).join(', ')} · Closes {formatDateTime(rfq.closeAt)}
              </div>
              {rfq.status === 'AWARDED' && (
                <div className="small">
                  Awarded to you
                  {rfq.purchaseOrder ? (
                    <>
                      {' '}
                      · <Link to="/purchase-orders">{rfq.purchaseOrder.poNumber}</Link>
                    </>
                  ) : (
                    ' · your purchase order will appear here once it is issued'
                  )}
                </div>
              )}
            </div>
            <div className="row-actions">
              <StatusBadge status={rfq.status} />
              <button className="btn btn-sm" onClick={() => setOpenId(openId === rfq._id ? null : rfq._id)}>
                {openId === rfq._id ? 'Hide' : 'View / Bid'}
              </button>
            </div>
          </div>
          {openId === rfq._id && <BidForm rfq={rfq} vendor={profile.data} />}
        </Card>
      ))}
    </Page>
  );
}
