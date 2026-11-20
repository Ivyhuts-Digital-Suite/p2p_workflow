import { FormEvent, useMemo, useState } from 'react';
import { poApi, serviceEntryApi } from '../../api/services';
import { askReason, Modal } from '../../components/overlays';
import { LockBanner } from '../../components/Workflow';
import { Empty, ErrorBanner, Page, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import { NEEDS_COMMISSIONING } from '../../types';
import { formatDate, poLabel, productName } from '../../utils/format';

const SIGNABLE = ['ISSUED', 'ACKNOWLEDGED', 'PARTIALLY_RECEIVED', 'RECEIVED'];
const today = () => new Date().toISOString().slice(0, 10);

/** Services and equipment commissioning aren't received at the dock: the department records them and its HOD accepts. */
export function ServiceEntriesPage() {
  const { user, hasRole } = useAuth();
  const canRaise = hasRole('REQUESTER', 'HOD', 'STORE', 'PROCUREMENT');
  const canDecide = hasRole('HOD');
  const pos = useApi(() => poApi.list({ view: 'active' }));
  const entries = useApi(() => serviceEntryApi.list());
  const [poId, setPoId] = useState('');
  const [lineId, setLineId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [completedOn, setCompletedOn] = useState(today);
  const [remarks, setRemarks] = useState('');
  const [recording, setRecording] = useState(false);
  const action = useAction(async () => {
    setRecording(false);
    setPoId('');
    setLineId('');
    setRemarks('');
    await Promise.all([pos.reload(), entries.reload()]);
  });
  const decision = useAction(async () => {
    await Promise.all([pos.reload(), entries.reload()]);
  });

  const signable = useMemo(
    () => pos.data?.filter((p) => SIGNABLE.includes(p.status) && p.items.some((i) => i.itemType === 'SERVICE' || NEEDS_COMMISSIONING.includes(i.itemType ?? ''))) ?? [],
    [pos.data],
  );
  const po = signable.find((p) => p._id === poId);
  const lines = po?.items.filter((i) => i.itemType === 'SERVICE' || NEEDS_COMMISSIONING.includes(i.itemType ?? '')) ?? [];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(
      () => serviceEntryApi.create({ purchaseOrderId: poId, poItemId: lineId, quantity, completedOn, remarks: remarks || undefined }),
      'Sign-off recorded. It now needs the HOD to accept it.',
    );
  };

  return (
    <Page
      title="Service & Commissioning Sign-off"
      actions={
        canRaise && (
          <button className="btn btn-primary" onClick={() => setRecording(true)}>
            + Record sign-off
          </button>
        )
      }
    >
      <ErrorBanner message={pos.error ?? entries.error ?? action.error ?? decision.error} onClose={action.error ? action.clearError : decision.clearError} />
      {canRaise && recording && (
        <Modal title="Record completed work" onClose={() => setRecording(false)} wide dismissible={false}>
        <form className="form" onSubmit={onSubmit}>
          <ErrorBanner message={action.error} onClose={action.clearError} />
          <label>
            Purchase order
            <select value={poId} onChange={(e) => { setPoId(e.target.value); setLineId(''); }} required>
              <option value="">{signable.length ? 'Select PO…' : 'No active PO has services or equipment'}</option>
              {signable.map((p) => (
                <option key={p._id} value={p._id}>
                  {poLabel(p)}
                </option>
              ))}
            </select>
          </label>
          {po && (
            <div className="grid-3">
              <label>
                Line
                <select value={lineId} onChange={(e) => setLineId(e.target.value)} required>
                  <option value="">Select line…</option>
                  {lines.map((i) => (
                    <option key={i._id} value={i._id}>
                      {productName(i)} ({i.itemType === 'SERVICE' ? `${i.receivedQty} of ${i.quantity} accepted` : `${i.commissionedQty ?? 0} of ${i.receivedQty} delivered commissioned`})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quantity
                <input type="number" min={0.01} step="any" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required />
              </label>
              <label>
                Completed on
                <input type="date" max={today()} value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} required />
              </label>
            </div>
          )}
          {po && (
            <label>
              Remarks
              <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="What was done, or the installation and calibration result" />
            </label>
          )}
          <div className="form-footer">
            <div className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={() => setRecording(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={action.busy || !po}>
              Record sign-off
            </button>
          </div>
        </form>
        </Modal>
      )}

      {!canDecide && entries.data?.some((e) => e.status === 'PENDING') && (
        <LockBanner message="Action locked: Approval pending at the Head of Department. Please wait until completion." />
      )}
      {!entries.data?.length ? (
        <Empty>No sign-offs yet.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Entry</th>
              <th>Type</th>
              <th>PO</th>
              <th>Vendor</th>
              <th>Item</th>
              <th className="num">Qty</th>
              <th>Completed</th>
              <th>Remarks</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.data.map((entry) => (
              <tr key={entry._id}>
                <td className="mono">{entry.entryNumber}</td>
                <td>{entry.type === 'SERVICE' ? 'Service' : 'Commissioning'}</td>
                <td className="mono">{entry.purchaseOrder?.poNumber}</td>
                <td>{entry.vendor?.companyName}</td>
                <td>{entry.description}</td>
                <td className="num">{entry.quantity}</td>
                <td>{formatDate(entry.completedOn)}</td>
                <td>
                  {entry.remarks ?? '-'}
                  {entry.decisionRemarks && <div className="muted small">{entry.decisionRemarks}</div>}
                </td>
                <td>
                  <StatusBadge status={entry.status} />
                </td>
                <td className="row-actions">
                  {canDecide && entry.status === 'PENDING' && (
                    <>
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={decision.busy || entry.raisedBy?._id === user?._id}
                        title={entry.raisedBy?._id === user?._id ? 'You raised this, so someone else must accept it' : ''}
                        onClick={() => void decision.run(() => serviceEntryApi.accept(entry._id), `${entry.entryNumber} accepted: it can now be billed`)}
                      >
                        Accept
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={decision.busy}
                        onClick={async () => {
                          const reason = await askReason(`Reject ${entry.entryNumber}`, 3, 'Reject');
                          if (reason) void decision.run(() => serviceEntryApi.reject(entry._id, reason), `${entry.entryNumber} rejected`);
                        }}
                      >
                        Reject
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}
