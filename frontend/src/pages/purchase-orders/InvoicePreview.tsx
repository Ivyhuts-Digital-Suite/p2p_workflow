import { PriceBreakdown } from '../../components/Workflow';
import { StatusBadge } from '../../components/ui';
import type { PoInvoice, PurchaseOrder } from '../../types';
import { formatDate, formatMoney, productName } from '../../utils/format';

/** The vendor's submitted invoice(s) on one PO, read only: the bill as the Store sees it from that PO's row. */
export function InvoicePreview({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const invoices: PoInvoice[] = [...(po.invoices ?? [])].reverse();
  return (
    <div className="form">
      {invoices.map((inv) => (
        <section key={inv._id} className="invoice-preview">
          <dl className="kv">
            <dt>Invoice reference</dt>
            <dd className="mono">{inv.internalRef}</dd>
            <dt>Vendor invoice / challan #</dt>
            <dd className="mono">{inv.invoiceNumber}</dd>
            <dt>Invoice date</dt>
            <dd>{formatDate(inv.invoiceDate)}</dd>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={inv.status} />
            </dd>
            <dt>PO</dt>
            <dd className="mono">{po.poNumber}</dd>
            <dt>Vendor</dt>
            <dd>
              {po.vendor?.companyName}
              {po.vendor?.contactPerson && <span className="muted"> · {po.vendor.contactPerson}</span>}
            </dd>
            <dt>Boxes / cartons on paperwork</dt>
            <dd>{inv.boxesOnPaperwork}</dd>
          </dl>
          <table className="table">
            <thead>
              <tr>
                <th>Item / Product Name</th>
                <th className="num">Quantity</th>
                <th className="num">Unit price</th>
                <th className="num">GST %</th>
                <th className="num">Line total</th>
              </tr>
            </thead>
            <tbody>
              {inv.items.map((line, index) => (
                <tr key={`${line.poItem}-${index}`}>
                  <td>{productName(line)}</td>
                  <td className="num">{line.quantity}</td>
                  <td className="num">{formatMoney(line.unitPrice)}</td>
                  <td className="num">{line.taxRate}%</td>
                  <td className="num">{formatMoney(line.lineTotal || line.quantity * line.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Subtotal + Total tax = Grand total: <PriceBreakdown actual={inv.subtotal} tax={inv.gstAmount} total={inv.total} />
          </p>
        </section>
      ))}
      <div className="form-footer">
        <div className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
