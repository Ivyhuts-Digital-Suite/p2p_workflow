import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { invoiceApi, poApi } from '../../api/services';
import { PriceBreakdown } from '../../components/Workflow';
import { ErrorBanner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import { poLabel, productName } from '../../utils/format';

interface Line {
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

/**
 * Records a vendor invoice. Given a `purchaseOrderId` (from that PO's row) the form is fixed to that PO and
 * filled in from it: every line at the quantity still open to invoice, at the PO price and GST.
 */
export function SubmitInvoiceForm({ onSubmitted, onCancel, purchaseOrderId }: { onSubmitted: () => unknown; onCancel: () => void; purchaseOrderId?: string }) {
  const { user } = useAuth();
  const isVendor = user?.role === 'VENDOR';
  // The server decides what can be invoiced: for a vendor, only their own accepted POs with something left to bill.
  const pos = useApi(() => poApi.invoiceable());
  const [poId, setPoId] = useState(purchaseOrderId ?? '');
  const locked = !!purchaseOrderId;
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [boxesOnPaperwork, setBoxesOnPaperwork] = useState(0);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [claimedTotal, setClaimedTotal] = useState<number | ''>('');
  const action = useAction(onSubmitted);

  const po = pos.data?.find((p) => p._id === poId);
  const lineFor = (id: string): Line => {
    const poItem = po?.items.find((i) => i._id === id);
    return lines[id] ?? { quantity: locked ? poItem?.openToInvoiceQty ?? 0 : 0, unitPrice: poItem?.unitPrice ?? 0, taxRate: poItem?.taxRate ?? 18 };
  };
  const setLine = (id: string, patch: Partial<Line>) => setLines((l) => ({ ...l, [id]: { ...lineFor(id), ...patch } }));

  const actual = po?.items.reduce((sum, i) => sum + lineFor(i._id).quantity * lineFor(i._id).unitPrice, 0) ?? 0;
  const tax = po?.items.reduce((sum, i) => sum + (lineFor(i._id).quantity * lineFor(i._id).unitPrice * lineFor(i._id).taxRate) / 100, 0) ?? 0;
  const computed = actual + tax;


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
          boxesOnPaperwork,
          items,
        }),
      'Invoice submitted',
    );
  };

  return (
    <form className="form" onSubmit={onSubmit}>
      <ErrorBanner message={pos.error ?? action.error} onClose={action.clearError} />
      {locked ? (
        <div className="grid-2">
          <label>
            Purchase order
            <input value={po ? poLabel(po) : pos.loading ? 'Loading…' : ''} readOnly />
          </label>
          <label>
            Vendor
            <input value={po?.vendor?.companyName ?? ''} readOnly />
          </label>
        </div>
      ) : (
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
      )}
      <div className="grid-2">
        <label>
          Invoice number
          <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} required />
        </label>
        <label>
          Invoice date
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
        </label>
        <label>
          Boxes / cartons on paperwork
          <input type="number" min={0} step={1} value={boxesOnPaperwork} onChange={(e) => setBoxesOnPaperwork(Number(e.target.value))} />
        </label>
      </div>
      {locked && pos.data && !po && <div className="alert alert-info">This purchase order has nothing left to invoice.</div>}
      {!locked && pos.data?.length === 0 && (
        <div className="alert alert-info">
          {isVendor ? (
            <span>
              No purchase orders to invoice. A PO appears here once it has been awarded and issued to your company. See{' '}
              <Link to="/purchase-orders">Purchase Orders</Link>.
            </span>
          ) : (
            <span>No issued purchase orders have anything left to invoice.</span>
          )}
        </div>
      )}
      {po && (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>PO line</th>
                <th className="num">Ordered</th>
                <th className="num">Open to invoice</th>
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
                    <td>
                      {productName(i)}
                    </td>
                    <td className="num">{i.quantity}</td>
                    <td className="num">{i.openToInvoiceQty ?? 0}</td>
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
            <button className="btn btn-primary" disabled={action.busy}>
              Submit invoice
            </button>
          </div>
        </>
      )}
    </form>
  );
}
