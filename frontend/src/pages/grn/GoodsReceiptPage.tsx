import { Fragment, FormEvent, useMemo, useState } from 'react';
import { grnApi, poApi } from '../../api/services';
import { askReason, Modal } from '../../components/overlays';
import { Card, Empty, ErrorBanner, Page, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import type { GoodsReceipt } from '../../types';
import { BATCH_TRACKED, ITEM_TYPE_LABELS, SERIAL_TRACKED } from '../../types';
import { formatDate, poLabel } from '../../utils/format';

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

const RECEIVABLE = ['ISSUED', 'ACKNOWLEDGED', 'PARTIALLY_RECEIVED'];
const EMPTY_LINE: LineInput = { receivedQty: 0, acceptedQty: 0, qualityStatus: 'PASSED', rejectionReason: '', shortageReason: '', batchNumber: '', expiryDate: '', serials: '' };
const isSerialised = (type?: string) => SERIAL_TRACKED.includes(type ?? '');
const today = () => new Date().toISOString().slice(0, 10);

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

export function GoodsReceiptPage() {
  const { hasRole } = useAuth();
  const canReceive = hasRole('STORE');
  const pos = useApi(() => poApi.list());
  const grns = useApi(() => grnApi.list());
  const inventory = useApi(() => grnApi.inventory());
  const nearExpiry = useApi(() => grnApi.nearExpiry());
  const returns = useApi(() => grnApi.returns());
  const [poId, setPoId] = useState('');
  const [warehouse, setWarehouse] = useState('MAIN-WH');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [boxesExpected, setBoxesExpected] = useState(0);
  const [boxesCounted, setBoxesCounted] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, LineInput>>({});
  const [receiving, setReceiving] = useState(false);
  const [returning, setReturning] = useState<{ grn: GoodsReceipt; line: GoodsReceipt['items'][number] } | null>(null);
  const refresh = async () => {
    await Promise.all([pos.reload(), grns.reload(), inventory.reload(), nearExpiry.reload(), returns.reload()]);
  };
  const action = useAction(async () => {
    setReceiving(false);
    setPoId('');
    setDeliveryNote('');
    setBoxesExpected(0);
    setBoxesCounted(0);
    setRemarks('');
    setLines({});
    await refresh();
  });
  const returnAction = useAction(refresh);

  const receivable = useMemo(() => pos.data?.filter((p) => RECEIVABLE.includes(p.status) && p.items.some((i) => i.itemType !== 'SERVICE')) ?? [], [pos.data]);
  const po = receivable.find((p) => p._id === poId);
  const goodsLines = po?.items.filter((i) => i.itemType !== 'SERVICE') ?? [];

  const lineFor = (id: string): LineInput => lines[id] ?? EMPTY_LINE;
  const setLine = (id: string, patch: Partial<LineInput>) => setLines((l) => ({ ...l, [id]: { ...lineFor(id), ...patch } }));
  const boxMismatch = boxesExpected !== boxesCounted;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!po) return;
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
          deliveryNoteNumber: deliveryNote,
          physicalCheck: { boxesExpected, boxesCounted },
          qcRemarks: remarks || undefined,
          items,
        }),
      'GRN posted. Accepted goods are now in stock.',
    );
  };

  return (
    <Page
      title="Goods Receipt (MW GRN)"
      actions={
        canReceive && (
          <button className="btn btn-primary" onClick={() => setReceiving(true)}>
            + Receive goods
          </button>
        )
      }
    >
      <ErrorBanner message={pos.error ?? grns.error ?? action.error ?? returnAction.error} onClose={action.error ? action.clearError : returnAction.clearError} />
      {canReceive && receiving && (
        <Modal title="Physical inspection & receipt" onClose={() => setReceiving(false)} extraWide dismissible={false}>
        <form className="form" onSubmit={onSubmit}>
          <ErrorBanner message={action.error} onClose={action.clearError} />
          <label>
            Purchase order
            <select value={poId} onChange={(e) => setPoId(e.target.value)} required>
              <option value="">Select PO…</option>
              {receivable.map((p) => (
                <option key={p._id} value={p._id}>
                  {poLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid-3">
            <label>
              Warehouse
              <input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} required />
            </label>
            <label>
              Invoice / challan # *
              <input value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} required />
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
              <input
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                required={boxMismatch}
                placeholder={boxMismatch ? 'Explain the box count mismatch' : ''}
              />
            </label>
          </div>
          {po && (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Ordered</th>
                    <th className="num">Already received</th>
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
                          {i.description}
                          <div className="muted small">{ITEM_TYPE_LABELS[i.itemType ?? 'GOODS']}</div>
                        </td>
                        <td className="num">{i.quantity}</td>
                        <td className="num">{i.receivedQty}</td>
                        <td>
                          <input type="number" min={0} step="any" className="narrow" value={l.receivedQty}
                            onChange={(e) => {
                              const qty = Number(e.target.value);
                              setLine(i._id, { receivedQty: qty, acceptedQty: l.qualityStatus === 'PASSED' ? qty : Math.min(l.acceptedQty, qty) });
                            }} />
                        </td>
                        <td>
                          <select value={l.qualityStatus} onChange={(e) => {
                            const qualityStatus = e.target.value;
                            setLine(i._id, { qualityStatus, acceptedQty: qualityStatus === 'PASSED' ? l.receivedQty : 0 });
                          }}>
                            <option value="PASSED">Passed</option>
                            <option value="DAMAGED">Damaged</option>
                            <option value="QUALITY_FAILED">Quality failed</option>
                          </select>
                        </td>
                        <td>
                          <input type="number" min={0} max={l.receivedQty} step="any" className="narrow" value={l.acceptedQty}
                            disabled={l.qualityStatus === 'PASSED'}
                            onChange={(e) => setLine(i._id, { acceptedQty: Number(e.target.value) })} />
                        </td>
                        <td>
                          {isSerialised(i.itemType) ? (
                            <input value={l.serials} required={needsSerials} placeholder={`${l.acceptedQty} serial no(s), comma separated`} onChange={(e) => setLine(i._id, { serials: e.target.value })} />
                          ) : (
                            <>
                              <input value={l.batchNumber} required={needsBatch} placeholder={BATCH_TRACKED.includes(i.itemType ?? '') ? 'Batch number *' : 'Batch number'} onChange={(e) => setLine(i._id, { batchNumber: e.target.value })} />
                              <input type="date" value={l.expiryDate} required={needsBatch} aria-label="Expiry date" onChange={(e) => setLine(i._id, { expiryDate: e.target.value })} />
                              {expired && l.acceptedQty > 0 && <div className="expiry-past small">Expired: reject this quantity</div>}
                            </>
                          )}
                        </td>
                        <td>
                          <input value={l.rejectionReason} disabled={l.acceptedQty >= l.receivedQty} required={l.acceptedQty < l.receivedQty}
                            onChange={(e) => setLine(i._id, { rejectionReason: e.target.value })} />
                        </td>
                        <td>
                          <input value={l.shortageReason} disabled={!shortage} required={shortage}
                            placeholder={shortage ? `Short by ${i.quantity - i.receivedQty - l.receivedQty}` : ''}
                            onChange={(e) => setLine(i._id, { shortageReason: e.target.value })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="muted small">This is the quality inspection: accepted goods enter stock and can be billed, and rejected goods can be returned. Two batches of one item need two GRNs.</p>
              <div className="form-footer">
                <div className="spacer" />
                <button className="btn btn-primary" disabled={action.busy}>
                  Post MW GRN
                </button>
              </div>
            </>
          )}
          {!po && (
            <div className="form-footer">
              <div className="spacer" />
              <button type="button" className="btn btn-ghost" onClick={() => setReceiving(false)}>
                Cancel
              </button>
            </div>
          )}
        </form>
        </Modal>
      )}

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
                      <td>{g.items.map((l) => l.description).join(', ')}</td>
                      <td>{g.deliveryNoteNumber ?? '-'}</td>
                      <td>{g.physicalCheck ? `${g.physicalCheck.boxesCounted} / ${g.physicalCheck.boxesExpected}` : '-'}</td>
                      <td>{formatDate(g.receivedAt)}</td>
                      <td>
                        <StatusBadge status={g.status} />
                      </td>
                    </tr>
                    {expanded === g._id && (
                      <tr>
                        <td colSpan={8}>
                          {g.qcRemarks && <p className="small">Remarks: {g.qcRemarks}</p>}
                          <ul className="grn-lines small">
                            {g.items.map((l) => {
                              const returnable = l.rejectedQty + (l.qcRejectedQty ?? 0) - (l.returnedQty ?? 0);
                              return (
                                <li key={l._id}>
                                  <strong>{l.description}</strong>: received {l.receivedQty}, accepted {l.acceptedQty}
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
    </Page>
  );
}
