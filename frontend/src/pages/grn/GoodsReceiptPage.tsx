import { Fragment, FormEvent, useState } from 'react';
import { grnApi } from '../../api/services';
import { askReason, Modal } from '../../components/overlays';
import { Card, Empty, ErrorBanner, Page, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import type { GoodsReceipt } from '../../types';
import { formatDate, productName } from '../../utils/format';

function RaiseReturnDialog({ grn, line, onClose, onDone }: { grn: GoodsReceipt; line: GoodsReceipt['items'][number]; onClose: () => void; onDone: () => unknown }) {
  const open = (line.rejectedQty + (line.qcRejectedQty ?? 0)) - (line.returnedQty ?? 0);
  const [quantity, setQuantity] = useState(open);
  const [reason, setReason] = useState(line.rejectionReason ?? '');
  const [resolution, setResolution] = useState<'REPLACE' | 'CREDIT'>('REPLACE');
  const action = useAction(async () => {
    onClose();
    await onDone();
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(() => grnApi.createReturn(grn._id, { grnLineId: line._id, quantity, reason, resolution }), `Return raised for ${quantity} ${line.description}`);
  };

  return (
    <Modal title={`Return ${line.description}`} onClose={onClose}>
      <form className="form" onSubmit={onSubmit}>
        <ErrorBanner message={action.error} onClose={action.clearError} />
        <label>
          Quantity (up to {open})
          <input type="number" min={0.01} max={open} step="any" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required />
        </label>
        <label>
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
        </label>
        <label>
          What the vendor should do
          <select value={resolution} onChange={(e) => setResolution(e.target.value as 'REPLACE' | 'CREDIT')}>
            <option value="REPLACE">Send a replacement</option>
            <option value="CREDIT">Issue a credit</option>
          </select>
        </label>
        <div className="form-footer">
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={action.busy}>
            Raise return
          </button>
        </div>
      </form>
    </Modal>
  );
}

const ZOOM_STEP = 0.5;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

/** One GRN's photos: the selected one large, with zoom (scroll to pan when zoomed in) and switching between photos. */
function GrnPhotoViewer({ grn, onClose }: { grn: GoodsReceipt; onClose: () => void }) {
  const photos = grn.photos ?? [];
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const show = (next: number) => {
    setIndex((next + photos.length) % photos.length);
    setZoom(ZOOM_MIN);
  };
  const zoomBy = (delta: number) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + delta)));

  return (
    <Modal title={`Photos: ${grn.grnNumber} · ${grn.purchaseOrder?.poNumber ?? ''}`} onClose={onClose} extraWide>
      <div className="photo-viewer-controls">
        <button type="button" className="btn btn-sm" onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">
          −
        </button>
        <span className="small">{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn btn-sm" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setZoom(ZOOM_MIN)} disabled={zoom === ZOOM_MIN}>
          Reset
        </button>
        {photos.length > 1 && (
          <>
            <div className="spacer" />
            <button type="button" className="btn btn-sm" onClick={() => show(index - 1)}>
              ‹ Previous
            </button>
            <span className="small">
              {index + 1} of {photos.length}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => show(index + 1)}>
              Next ›
            </button>
          </>
        )}
      </div>
      <div className="photo-viewer">
        <img
          src={photos[index]}
          alt={`Delivery photo ${index + 1} for ${grn.grnNumber}`}
          style={{ width: `${zoom * 100}%`, cursor: zoom > ZOOM_MIN ? 'zoom-out' : 'zoom-in' }}
          onClick={() => setZoom((z) => (z > ZOOM_MIN ? ZOOM_MIN : 2))}
        />
      </div>
      {photos.length > 1 && (
        <div className="photo-thumbs">
          {photos.map((src, i) => (
            <button key={i} type="button" className={`photo-thumb-pick${i === index ? ' active' : ''}`} onClick={() => show(i)} aria-label={`Show photo ${i + 1}`}>
              <img src={src} alt="" />
            </button>
          ))}
        </div>
      )}
      <div className="form-footer">
        <div className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export function GoodsReceiptPage() {
  const { hasRole } = useAuth();
  const canReceive = hasRole('STORE');
  const grns = useApi(() => grnApi.list());
  const inventory = useApi(() => grnApi.inventory());
  const nearExpiry = useApi(() => grnApi.nearExpiry());
  const returns = useApi(() => grnApi.returns());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [returning, setReturning] = useState<{ grn: GoodsReceipt; line: GoodsReceipt['items'][number] } | null>(null);
  // The one GRN whose row opened the photo viewer.
  const [viewingPhotos, setViewingPhotos] = useState<GoodsReceipt | null>(null);
  const refresh = async () => {
    await Promise.all([grns.reload(), inventory.reload(), nearExpiry.reload(), returns.reload()]);
  };
  const returnAction = useAction(refresh);

  // Goods are received from Purchase Orders, against each PO's vendor invoice.
  return (
    <Page title="Goods Receipt (MW GRN)">
      <ErrorBanner message={grns.error ?? returnAction.error} onClose={returnAction.clearError} />

      {!!nearExpiry.data?.rows.length && (
        <Card title={`Expiring stock (within ${nearExpiry.data.days} days)`}>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Warehouse</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th className="num">Days left</th>
                <th className="num">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {nearExpiry.data.rows.map((row) => (
                <tr key={`${row.description}-${row.warehouse}-${row.batchNumber}`}>
                  <td>{row.description}</td>
                  <td>{row.warehouse}</td>
                  <td className="mono">{row.batchNumber ?? '-'}</td>
                  <td className={row.expired ? 'expiry-past' : 'expiry-soon'}>{formatDate(row.expiryDate)}</td>
                  <td className="num">{row.expired ? 'Expired' : row.daysLeft}</td>
                  <td className="num">
                    {row.quantity} {row.uom}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="grid-2">
        <Card title="Recent GRNs">
          {!grns.data?.length ? (
            <Empty>No goods receipts yet.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>GRN #</th>
                  <th>PO</th>
                  <th>Vendor</th>
                  <th>Items</th>
                  <th>Invoice / challan</th>
                  <th>Boxes</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Photos</th>
                </tr>
              </thead>
              <tbody>
                {grns.data.map((g) => (
                  <Fragment key={g._id}>
                    <tr>
                      <td className="mono">
                        <button className="link" onClick={() => setExpanded(expanded === g._id ? null : g._id)}>
                          {g.grnNumber}
                        </button>
                      </td>
                      <td className="mono">{g.purchaseOrder?.poNumber}</td>
                      <td>{g.vendor?.companyName}</td>
                      <td>{g.items.map((l) => `${productName(l)} × ${l.receivedQty}`).join(', ')}</td>
                      <td>{g.deliveryNoteNumber ?? '-'}</td>
                      <td>{g.physicalCheck ? `${g.physicalCheck.boxesCounted} / ${g.physicalCheck.boxesExpected}` : '-'}</td>
                      <td>{formatDate(g.receivedAt)}</td>
                      <td>
                        <StatusBadge status={g.status} />
                      </td>
                      <td>
                        {!!g.photos?.length && (
                          <button type="button" className="btn btn-sm" onClick={() => setViewingPhotos(g)}>
                            View Photos ({g.photos.length})
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === g._id && (
                      <tr>
                        <td colSpan={9}>
                          {g.qcRemarks && <p className="small">Remarks: {g.qcRemarks}</p>}
                          {!!g.photos?.length && (
                            <div className="photo-thumbs photo-thumbs-large">
                              {g.photos.map((src, index) => (
                                <img key={index} src={src} alt={`Delivery photo ${index + 1} for ${g.grnNumber}`} />
                              ))}
                            </div>
                          )}
                          <ul className="grn-lines small">
                            {g.items.map((l) => {
                              const returnable = l.rejectedQty + (l.qcRejectedQty ?? 0) - (l.returnedQty ?? 0);
                              return (
                                <li key={l._id}>
                                  <strong>{productName(l)}</strong>: received {l.receivedQty}, accepted {l.acceptedQty}
                                  {l.qcReleasedQty !== undefined && `, released by QC ${l.qcReleasedQty}`}
                                  {!!l.qcRejectedQty && `, rejected by QC ${l.qcRejectedQty}`}
                                  {l.rejectedQty > 0 && `, rejected ${l.rejectedQty} (${l.rejectionReason})`}
                                  {!!l.shortageQty && `, short ${l.shortageQty} (${l.shortageReason})`}
                                  {l.qualityStatus && l.qualityStatus !== 'PASSED' && ` · ${l.qualityStatus.replace(/_/g, ' ')}`}
                                  {l.batchNumber && ` · batch ${l.batchNumber}`}
                                  {l.expiryDate && ` · expires ${formatDate(l.expiryDate)}`}
                                  {!!l.serialNumbers?.length && ` · serials ${l.serialNumbers.join(', ')}`}
                                  {canReceive && returnable > 0 && (
                                    <>
                                      {' '}
                                      <button className="btn btn-sm" onClick={() => setReturning({ grn: g, line: l })}>
                                        Return {returnable}
                                      </button>
                                    </>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Inventory">
          {!inventory.data?.length ? (
            <Empty>No stock on hand.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Warehouse</th>
                  <th>Batches</th>
                  <th className="num">On hand</th>
                </tr>
              </thead>
              <tbody>
                {inventory.data.map((i) => (
                  <tr key={i._id}>
                    <td>{i.description}</td>
                    <td>{i.warehouse}</td>
                    <td className="small">
                      {i.batches?.filter((b) => b.batchNumber).map((b) => `${b.batchNumber} (${formatDate(b.expiryDate)})`).join(', ') || '-'}
                    </td>
                    <td className="num">
                      {i.quantity} {i.uom}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Returns to vendor">
        {!returns.data?.length ? (
          <Empty>No returns. Open a GRN to return rejected goods.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Return #</th>
                <th>PO</th>
                <th>Vendor</th>
                <th>Item</th>
                <th className="num">Qty</th>
                <th>Reason</th>
                <th>Resolution</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {returns.data.map((r) => (
                <tr key={r._id}>
                  <td className="mono">{r.returnNumber}</td>
                  <td className="mono">{r.purchaseOrder?.poNumber}</td>
                  <td>{r.vendor?.companyName}</td>
                  <td>{r.description}</td>
                  <td className="num">{r.quantity}</td>
                  <td>{r.reason}</td>
                  <td>{r.resolution === 'REPLACE' ? 'Replacement' : 'Credit'}</td>
                  <td>
                    <StatusBadge status={r.status} />
                    {r.carrierReference && <div className="muted small">{r.carrierReference}</div>}
                  </td>
                  <td className="row-actions">
                    {canReceive && r.status === 'RAISED' && (
                      <button
                        className="btn btn-sm"
                        disabled={returnAction.busy}
                        onClick={async () => {
                          const reference = await askReason(`Dispatch ${r.returnNumber}: carrier or dispatch reference`, 1, 'Mark dispatched');
                          if (reference) void returnAction.run(() => grnApi.dispatchReturn(r._id, reference), `${r.returnNumber} dispatched`);
                        }}
                      >
                        Dispatch
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {returning && <RaiseReturnDialog grn={returning.grn} line={returning.line} onClose={() => setReturning(null)} onDone={refresh} />}
      {viewingPhotos && <GrnPhotoViewer grn={viewingPhotos} onClose={() => setViewingPhotos(null)} />}
    </Page>
  );
}
