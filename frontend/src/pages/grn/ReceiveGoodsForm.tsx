import { ChangeEvent, FormEvent, useState } from 'react';
import { grnApi } from '../../api/services';
import { ErrorBanner } from '../../components/ui';
import { useAction } from '../../hooks/useApi';
import type { InvoiceToReceive, PurchaseOrder } from '../../types';
import { BATCH_TRACKED, ITEM_TYPE_LABELS, SERIAL_TRACKED } from '../../types';
import { formatDate, productName } from '../../utils/format';

interface LineInput {
  receivedQty: number;
  acceptedQty: number;
  qualityStatus: string;
  rejectionReason: string;
  shortageReason: string;
  batchNumber: string;
  expiryDate: string;
  serials: string;
}

const EMPTY_LINE: LineInput = { receivedQty: 0, acceptedQty: 0, qualityStatus: 'PASSED', rejectionReason: '', shortageReason: '', batchNumber: '', expiryDate: '', serials: '' };
const isSerialised = (type?: string) => SERIAL_TRACKED.includes(type ?? '');
const today = () => new Date().toISOString().slice(0, 10);

/** Photos are shrunk in the browser so a GRN stays well inside the server's request limit. */
const PHOTO_MAX_SIDE = 1600;
const PHOTO_QUALITY = 0.75;
const PHOTOS_MAX_TOTAL = 4_000_000;

async function compressPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`${file.name} could not be read as an image`));
      img.src = url;
    });
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The GRN for one PO, received against that PO's own vendor invoice: the PO, vendor and invoice / challan
 * number are fixed, and the quantities start from the invoice. The Store inspects and adjusts, and can
 * attach photos of the delivery.
 */
export function ReceiveGoodsForm({ po, invoice, onDone, onCancel }: { po: PurchaseOrder; invoice: InvoiceToReceive; onDone: () => unknown; onCancel: () => void }) {
  const goodsLines = po.items.filter((i) => i.itemType !== 'SERVICE');
  const invoicedQty = (poItemId: string) => invoice.items.find((l) => l.poItem === poItemId)?.quantity ?? 0;
  const [warehouse, setWarehouse] = useState('MAIN-WH');
  // Boxes on paperwork come from this PO's vendor invoice; the Store still counts the boxes itself.
  const [boxesExpected, setBoxesExpected] = useState(invoice.boxesOnPaperwork ?? 0);
  const [boxesCounted, setBoxesCounted] = useState(0);
  const [remarks, setRemarks] = useState('');
  // Received and accepted start at what the vendor invoiced on each line.
  const [lines, setLines] = useState<Record<string, LineInput>>(() =>
    Object.fromEntries(goodsLines.map((i) => [i._id, { ...EMPTY_LINE, receivedQty: invoicedQty(i._id), acceptedQty: invoicedQty(i._id) }])),
  );
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const action = useAction(onDone);

  const lineFor = (id: string): LineInput => lines[id] ?? EMPTY_LINE;
  const setLine = (id: string, patch: Partial<LineInput>) => setLines((l) => ({ ...l, [id]: { ...lineFor(id), ...patch } }));
  const boxMismatch = boxesExpected !== boxesCounted;

  const addPhotos = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    setPhotoError(null);
    try {
      const added = await Promise.all(files.map(compressPhoto));
      const next = [...photos, ...added];
      if (next.reduce((sum, p) => sum + p.length, 0) > PHOTOS_MAX_TOTAL) {
        setPhotoError('These photos are too large together. Remove one or attach fewer.');
        return;
      }
      setPhotos(next);
    } catch (err) {
      setPhotoError((err as Error).message);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const items = goodsLines
      .map((i) => ({ poItemId: i._id, ...lineFor(i._id) }))
      .filter((l) => l.receivedQty > 0)
      .map(({ serials, ...l }) => ({
        ...l,
        rejectionReason: l.rejectionReason || undefined,
        shortageReason: l.shortageReason || undefined,
        batchNumber: l.batchNumber || undefined,
        expiryDate: l.expiryDate || undefined,
        serialNumbers: serials.split(/[\s,]+/).filter(Boolean),
      }));
    void action.run(
      () =>
        grnApi.create({
          purchaseOrderId: po._id,
          warehouse,
          deliveryNoteNumber: invoice.invoiceNumber,
          physicalCheck: { boxesExpected, boxesCounted },
          qcRemarks: remarks || undefined,
          photos,
          items,
        }),
      `GRN posted for ${po.poNumber}. Accepted goods are now in stock.`,
    );
  };

  return (
    <form className="form" onSubmit={onSubmit}>
      <ErrorBanner message={action.error} onClose={action.clearError} />
      <div className="grid-3">
        <label>
          Purchase order
          <input value={po.poNumber} readOnly />
        </label>
        <label>
          Vendor
          <input value={po.vendor?.companyName ?? ''} readOnly />
        </label>
        <label>
          Vendor invoice / challan #
          <input value={invoice.invoiceNumber} readOnly title={`${invoice.internalRef}, dated ${formatDate(invoice.invoiceDate)}`} />
        </label>
        <label>
          Warehouse
          <input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} required />
        </label>
        <label>
          Boxes / cartons on paperwork *
          <input type="number" min={0} step={1} value={boxesExpected} onChange={(e) => setBoxesExpected(Number(e.target.value))} required />
        </label>
        <label>
          Boxes / cartons counted *
          <input type="number" min={0} step={1} value={boxesCounted} onChange={(e) => setBoxesCounted(Number(e.target.value))} required />
        </label>
        <label>
          Inspection remarks {boxMismatch && '*'}
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} required={boxMismatch} placeholder={boxMismatch ? 'Explain the box count mismatch' : ''} />
        </label>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Item / Product Name</th>
            <th className="num">Ordered</th>
            <th className="num">Already received</th>
            <th className="num">Invoiced</th>
            <th>Received now</th>
            <th>Quality check</th>
            <th>Accepted</th>
            <th>Batch / expiry / serials</th>
            <th>Rejection reason</th>
            <th>Shortage reason</th>
          </tr>
        </thead>
        <tbody>
          {goodsLines.map((i) => {
            const l = lineFor(i._id);
            const shortage = l.receivedQty > 0 && l.receivedQty < i.quantity - i.receivedQty;
            const needsBatch = BATCH_TRACKED.includes(i.itemType ?? '') && l.acceptedQty > 0;
            const needsSerials = isSerialised(i.itemType) && l.acceptedQty > 0;
            const expired = !!l.expiryDate && l.expiryDate <= today();
            return (
              <tr key={i._id}>
                <td>
                  {productName(i)}
                  <div className="muted small">{ITEM_TYPE_LABELS[i.itemType ?? 'GOODS']}</div>
                </td>
                <td className="num">{i.quantity}</td>
                <td className="num">{i.receivedQty}</td>
                <td className="num">{invoicedQty(i._id)}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    className="narrow"
                    value={l.receivedQty}
                    onChange={(e) => {
                      const qty = Number(e.target.value);
                      setLine(i._id, { receivedQty: qty, acceptedQty: l.qualityStatus === 'PASSED' ? qty : Math.min(l.acceptedQty, qty) });
                    }}
                  />
                </td>
                <td>
                  <select
                    value={l.qualityStatus}
                    onChange={(e) => {
                      const qualityStatus = e.target.value;
                      setLine(i._id, { qualityStatus, acceptedQty: qualityStatus === 'PASSED' ? l.receivedQty : 0 });
                    }}
                  >
                    <option value="PASSED">Passed</option>
                    <option value="DAMAGED">Damaged</option>
                    <option value="QUALITY_FAILED">Quality failed</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={l.receivedQty}
                    step="any"
                    className="narrow"
                    value={l.acceptedQty}
                    disabled={l.qualityStatus === 'PASSED'}
                    onChange={(e) => setLine(i._id, { acceptedQty: Number(e.target.value) })}
                  />
                </td>
                <td>
                  {isSerialised(i.itemType) ? (
                    <input value={l.serials} required={needsSerials} placeholder={`${l.acceptedQty} serial no(s), comma separated`} onChange={(e) => setLine(i._id, { serials: e.target.value })} />
                  ) : (
                    <>
                      <input
                        value={l.batchNumber}
                        required={needsBatch}
                        placeholder={BATCH_TRACKED.includes(i.itemType ?? '') ? 'Batch number *' : 'Batch number'}
                        onChange={(e) => setLine(i._id, { batchNumber: e.target.value })}
                      />
                      <input type="date" value={l.expiryDate} required={needsBatch} aria-label="Expiry date" onChange={(e) => setLine(i._id, { expiryDate: e.target.value })} />
                      {expired && l.acceptedQty > 0 && <div className="expiry-past small">Expired: reject this quantity</div>}
                    </>
                  )}
                </td>
                <td>
                  <input
                    value={l.rejectionReason}
                    disabled={l.acceptedQty >= l.receivedQty}
                    required={l.acceptedQty < l.receivedQty}
                    onChange={(e) => setLine(i._id, { rejectionReason: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    value={l.shortageReason}
                    disabled={!shortage}
                    required={shortage}
                    placeholder={shortage ? `Short by ${i.quantity - i.receivedQty - l.receivedQty}` : ''}
                    onChange={(e) => setLine(i._id, { shortageReason: e.target.value })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">This is the quality inspection: accepted goods enter stock and can be billed, and rejected goods can be returned. Two batches of one item need two GRNs.</p>
      <label>
        Attach photo
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => void addPhotos(e)} />
      </label>
      {photoError && <div className="alert alert-error">{photoError}</div>}
      {photos.length > 0 && (
        <div className="photo-thumbs">
          {photos.map((src, index) => (
            <div key={index} className="photo-thumb">
              <img src={src} alt={`Delivery photo ${index + 1}`} />
              <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setPhotos((p) => p.filter((_, i) => i !== index))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="form-footer">
        <div className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={action.busy}>
          Post MW GRN
        </button>
      </div>
    </form>
  );
}
