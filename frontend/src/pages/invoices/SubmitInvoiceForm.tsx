import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { invoiceApi, poApi } from '../../api/services';
import { LockBanner, PriceBreakdown } from '../../components/Workflow';
import { ErrorBanner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import { poLabel } from '../../utils/format';

interface Line {
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

export function SubmitInvoiceForm({ onSubmitted, onCancel }: { onSubmitted: () => unknown; onCancel: () => void }) {
  const { user } = useAuth();
  const isVendor = user?.role === 'VENDOR';
  // The server decides what can be invoiced: for a vendor, only their own accepted POs with something left to bill.
  const pos = useApi(() => poApi.invoiceable());
  const [poId, setPoId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [claimedTotal, setClaimedTotal] = useState<number | ''>('');
  const action = useAction(onSubmitted);

  const po = pos.data?.find((p) => p._id === poId);
  const lineFor = (id: string): Line => {
    const poItem = po?.items.find((i) => i._id === id);
    return lines[id] ?? { quantity: 0, unitPrice: poItem?.unitPrice ?? 0, taxRate: poItem?.taxRate ?? 18 };
  };
  const setLine = (id: string, patch: Partial<Line>) => setLines((l) => ({ ...l, [id]: { ...lineFor(id), ...patch } }));

  const actual = po?.items.reduce((sum, i) => sum + lineFor(i._id).quantity * lineFor(i._id).unitPrice, 0) ?? 0;
  const tax = po?.items.reduce((sum, i) => sum + (lineFor(i._id).quantity * lineFor(i._id).unitPrice * lineFor(i._id).taxRate) / 100, 0) ?? 0;
  const computed = actual + tax;

  const openToBill = (i: { clearedQty?: number; invoicedQty: number }) => Math.max((i.clearedQty ?? 0) - i.invoicedQty, 0);
  const nothingCleared = !!po && po.items.every((i) => openToBill(i) <= 0);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!po) return;
    const items = po.items.map((i) => ({ poItemId: i._id, ...lineFor(i._id) })).filter((l) => l.quantity > 0);
    void action.run(
      () =>
        invoiceApi.submit({
          purchaseOrderId: po._id,
          invoiceNumber,
          invoiceDate,
          claimedTotal: claimedTotal === '' ? Math.round(computed * 100) / 100 : claimedTotal,
          items,
        }),
      'Invoice submitted',
    );
  };

  return (
    <form className="form" onSubmit={onSubmit}>
      <ErrorBanner message={pos.error ?? action.error} onClose={action.clearError} />
      <label>
        Purchase order
        <select value={poId} onChange={(e) => { setPoId(e.target.value); setLines({}); }} required>
          <option value="">{pos.loading ? 'Loading POs…' : 'Select PO…'}</option>
          {pos.data?.map((p) => (
            <option key={p._id} value={p._id}>
              {poLabel(p)}
            </option>
          ))}
        </select>
      </label>
      <div className="grid-2">
        <label>
          Invoice number
          <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} required />
        </label>
        <label>
          Invoice date
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
        </label>
      </div>
      {pos.data?.length === 0 && (
        <div className="alert alert-info">
          {isVendor ? (
            <span>
              No purchase orders to invoice. A PO appears here once it has been awarded to your company and you have acknowledged it under{' '}
              <Link to="/purchase-orders">Purchase Orders</Link>.
            </span>
          ) : (
            <span>No issued purchase orders have anything left to invoice.</span>
          )}
        </div>
      )}
      {po && nothingCleared && (
        <LockBanner
          message={
            isVendor
              ? 'Action locked: goods receipt or service sign-off is pending at the hospital. Please wait until completion.'
              : 'Nothing on this PO has been accepted or signed off yet, so an invoice keyed now stops at the match until it does.'
          }
        />
      )}
      {po && (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>PO line</th>
                <th className="num">Ordered</th>
                <th className="num">Cleared to bill</th>
                <th>Qty billed</th>
                <th>Unit price</th>
                <th>GST %</th>
                <th className="num">Actual + Tax = Total</th>
              </tr>
            </thead>
            <tbody>
              {po.items.map((i) => {
                const l = lineFor(i._id);
                const lineActual = l.quantity * l.unitPrice;
                const lineTax = (lineActual * l.taxRate) / 100;
                return (
                  <tr key={i._id}>
                    <td>{i.description}</td>
                    <td className="num">{i.quantity}</td>
                    <td className="num">{openToBill(i)}</td>
                    <td>
                      <input type="number" min={0} step="any" className="narrow" value={l.quantity} onChange={(e) => setLine(i._id, { quantity: Number(e.target.value) })} />
                    </td>
                    <td>
                      <input type="number" min={0} step="any" value={l.unitPrice} onChange={(e) => setLine(i._id, { unitPrice: Number(e.target.value) })} />
                    </td>
                    <td>
                      <input type="number" min={0} className="narrow" value={l.taxRate} onChange={(e) => setLine(i._id, { taxRate: Number(e.target.value) })} />
                    </td>
                    <td className="num">
                      <PriceBreakdown compact actual={lineActual} tax={lineTax} total={lineActual + lineTax} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="form-footer">
            <PriceBreakdown actual={actual} tax={tax} total={computed} />
            <label className="inline">
              Invoice total as printed
              <input type="number" step="any" value={claimedTotal} placeholder={computed.toFixed(2)} onChange={(e) => setClaimedTotal(e.target.value === '' ? '' : Number(e.target.value))} />
            </label>
            <div className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={action.busy || (isVendor && nothingCleared)}>
              Submit invoice
            </button>
          </div>
        </>
      )}
    </form>
  );
}
