import { FormEvent, useState } from 'react';
import { adminApi, requisitionApi } from '../../api/services';
import { ItemSearch } from '../../components/ItemSearch';
import { ErrorBanner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import type { ItemType, PrItem, Requisition } from '../../types';
import { ITEM_TYPE_LABELS } from '../../types';
import { formatMoney } from '../../utils/format';

const blankItem = (): PrItem => ({ title: '', description: '', quantity: 1, uom: 'EA', estimatedUnitPrice: 0, itemType: 'GOODS' });
const COMMON_JUSTIFICATIONS = ['Urgent stock restock', 'Monthly consumption items', 'Emergency clinical requirement'];
const CUSTOM = 'CUSTOM';

const toLine = ({ itemCode, title, description, category, quantity, uom, estimatedUnitPrice, itemType }: PrItem): PrItem => ({
  itemCode,
  title: title?.trim() || undefined,
  description,
  category,
  quantity,
  uom,
  estimatedUnitPrice,
  itemType,
});

/**
 * The PR form, shown in a popup. A new PR goes straight to its approvers. Given a PR, the form edits it,
 * and saving sends it back for approval.
 */
export function RequisitionForm({ onCreated, onCancel, pr }: { onCreated: () => void; onCancel: () => void; pr?: Requisition }) {
  const { user } = useAuth();
  const departments = useApi(() => adminApi.departments());
  const known = pr?.justification && COMMON_JUSTIFICATIONS.includes(pr.justification);
  const [title, setTitle] = useState(pr?.title ?? '');
  const [department, setDepartment] = useState(pr?.department?._id ?? user?.department?._id ?? '');
  const [reason, setReason] = useState(pr?.justification ? (known ? pr.justification : CUSTOM) : '');
  const [justification, setJustification] = useState(pr?.justification && !known ? pr.justification : '');
  const [priority, setPriority] = useState(pr?.priority ?? 'MEDIUM');
  const [items, setItems] = useState<PrItem[]>(pr ? pr.items.map(toLine) : [blankItem()]);
  const [isEmergency, setIsEmergency] = useState(pr?.isEmergency ?? false);
  const [emergencyReason, setEmergencyReason] = useState(pr?.emergencyReason ?? '');
  const { run, error, busy } = useAction(onCreated);

  const updateItem = (index: number, patch: Partial<PrItem>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const total = items.reduce((sum, i) => sum + i.quantity * i.estimatedUnitPrice, 0);
  const activeDepartments = departments.data?.filter((d) => d.isActive) ?? [];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const body = {
      title,
      department,
      justification: reason === CUSTOM ? justification : reason,
      priority,
      items: items.map(toLine),
      isEmergency,
      emergencyReason: isEmergency ? emergencyReason : undefined,
    };
    void run(
      () => (pr ? requisitionApi.update(pr._id, body) : requisitionApi.create(body)),
      pr ? `${pr.prNumber} updated and sent for approval again` : 'PR submitted for approval',
    );
  };

  return (
    <form className="form" onSubmit={onSubmit}>
      <ErrorBanner message={error ?? departments.error} />
      <div className="grid-3">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} />
        </label>
        <label>
          Department *
          <select value={department} onChange={(e) => setDepartment(e.target.value)} required>
            <option value="">Select department…</option>
            {activeDepartments.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name} ({d.code})
              </option>
            ))}
          </select>
          <span className="muted small">Its Head of Department approves this PR.</span>
        </label>
        <label>
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Business justification
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Select…</option>
          {COMMON_JUSTIFICATIONS.map((text) => (
            <option key={text}>{text}</option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
      </label>
      {reason === CUSTOM && (
        <label>
          Your justification
          <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} required autoFocus />
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={isEmergency} onChange={(e) => setIsEmergency(e.target.checked)} />
        Emergency purchase: urgent clinical need that cannot wait for an RFQ
      </label>
      {isEmergency && (
        <label>
          Why is this an emergency? *
          <textarea value={emergencyReason} onChange={(e) => setEmergencyReason(e.target.value)} rows={2} required minLength={10} />
          <span className="muted small">Only the HOD approves it. Procurement then buys directly, up to a value cap, and Finance must ratify it before payment.</span>
        </label>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Item code</th>
            <th>Product title *</th>
            <th>Description</th>
            <th>Type</th>
            <th>Qty</th>
            <th>UoM</th>
            <th>Est. unit price</th>
            <th>Line total</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={index}>
              <td>
                <input value={item.itemCode ?? ''} aria-label="Item code" onChange={(e) => updateItem(index, { itemCode: e.target.value || undefined })} />
              </td>
              <td>
                <input
                  value={item.title ?? ''}
                  required
                  maxLength={200}
                  placeholder="e.g. Dell Latitude 5440 Laptop"
                  aria-label="Product title"
                  onChange={(e) => updateItem(index, { title: e.target.value })}
                />
              </td>
              <td>
                <ItemSearch
                  value={item.description}
                  onChange={(description) => updateItem(index, { description })}
                  onPick={(found) =>
                    updateItem(index, {
                      description: found.description,
                      itemCode: found.itemCode ?? item.itemCode,
                      uom: found.uom || item.uom,
                      estimatedUnitPrice: found.estimatedUnitPrice ?? item.estimatedUnitPrice,
                    })
                  }
                />
              </td>
              <td>
                <select value={item.itemType ?? 'GOODS'} aria-label="Item type" onChange={(e) => updateItem(index, { itemType: e.target.value as ItemType })}>
                  {(Object.keys(ITEM_TYPE_LABELS) as ItemType[]).map((type) => (
                    <option key={type} value={type}>
                      {ITEM_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input type="number" min={0.01} step="any" value={item.quantity} aria-label="Quantity" onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })} />
              </td>
              <td>
                <input value={item.uom} aria-label="Unit of measure" onChange={(e) => updateItem(index, { uom: e.target.value })} className="narrow" />
              </td>
              <td>
                <input type="number" min={0} step="any" value={item.estimatedUnitPrice} aria-label="Estimated unit price" onChange={(e) => updateItem(index, { estimatedUnitPrice: Number(e.target.value) })} />
              </td>
              <td>{formatMoney(item.quantity * item.estimatedUnitPrice)}</td>
              <td>
                {items.length > 1 && (
                  <button type="button" className="link" onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-footer">
        <button type="button" className="btn" onClick={() => setItems((prev) => [...prev, blankItem()])}>
          + Add line
        </button>
        <strong>Estimated total: {formatMoney(total)}</strong>
        <div className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {pr ? 'Save and resubmit' : 'Submit for approval'}
        </button>
      </div>
    </form>
  );
}
