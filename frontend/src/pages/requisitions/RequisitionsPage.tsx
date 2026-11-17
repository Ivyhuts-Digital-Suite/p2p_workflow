import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { requisitionApi, sourcingApi, vendorApi } from '../../api/services';
import { askReason, Modal } from '../../components/overlays';
import { CreateRfqForm } from '../sourcing/CreateRfqForm';
import { PrDetail } from './PrDetail';
import { LockBanner, PriceBreakdown } from '../../components/Workflow';
import { Empty, ErrorBanner, Page, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import type { Requisition } from '../../types';
import { ITEM_TYPE_LABELS } from '../../types';
import { formatDate, formatMoney, productName } from '../../utils/format';
import { RequisitionForm } from './RequisitionForm';

const GST_RATES = [0, 5, 12, 18, 28];

/** Procurement buys an approved emergency PR directly from one vendor. */
function EmergencyPurchaseDialog({ pr, onClose, onDone }: { pr: Requisition; onClose: () => void; onDone: () => unknown }) {
  const vendors = useApi(() => vendorApi.list({ status: 'APPROVED' }));
  const [vendorId, setVendorId] = useState('');
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [taxRate, setTaxRate] = useState(18);
  const [deliveryDays, setDeliveryDays] = useState(1);
  const [justification, setJustification] = useState(pr.emergencyReason ?? '');
  const action = useAction(async () => {
    onClose();
    await onDone();
  });

  const priceFor = (id?: string) => (id ? prices[id] ?? 0 : 0);
  const actual = pr.items.reduce((sum, i) => sum + i.quantity * priceFor(i._id), 0);
  const tax = (actual * taxRate) / 100;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const allPrices = Object.fromEntries(pr.items.map((i) => [i._id!, priceFor(i._id)]));
    void action.run(
      () => sourcingApi.emergencyPurchase({ requisitionId: pr._id, vendorId, prices: allPrices, taxRate, deliveryDays, justification }),
      'Emergency PO created and issued to the vendor. Finance must ratify it before it can be paid.',
    );
  };

  return (
    <Modal title={`Emergency purchase: ${pr.prNumber}`} onClose={onClose} wide>
      <form className="form" onSubmit={onSubmit}>
        <ErrorBanner message={vendors.error ?? action.error} onClose={action.clearError} />
        <label>
          Vendor
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
            <option value="">Select an approved vendor…</option>
            {vendors.data?.map((v) => (
              <option key={v._id} value={v._id}>
                {v.companyName} | {v.contactPerson}
              </option>
            ))}
          </select>
        </label>
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qty</th>
              <th className="num">Estimate</th>
              <th>Quoted unit price</th>
            </tr>
          </thead>
          <tbody>
            {pr.items.map((i) => (
              <tr key={i._id}>
                <td>
                  {productName(i)}
                  {i.title && <div className="muted small">{i.description}</div>}
                </td>
                <td className="num">
                  {i.quantity} {i.uom}
                </td>
                <td className="num">{formatMoney(i.estimatedUnitPrice)}</td>
                <td>
                  <input type="number" min={0} step="any" required value={priceFor(i._id)} aria-label={`Unit price for ${i.description}`} onChange={(e) => setPrices((p) => ({ ...p, [i._id!]: Number(e.target.value) }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid-2">
          <label>
            GST
            <select value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))}>
              {GST_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </select>
          </label>
          <label>
            Delivery (days)
            <input type="number" min={0} value={deliveryDays} onChange={(e) => setDeliveryDays(Number(e.target.value))} />
          </label>
        </div>
        <p>
          <PriceBreakdown actual={actual} tax={tax} total={actual + tax} />
        </p>
        <label>
          Justification *
          <textarea rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} required minLength={10} />
        </label>
        <div className="form-footer">
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={action.busy}>
            Create emergency PO
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function RequisitionsPage() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [buying, setBuying] = useState<Requisition | null>(null);
  const [bidding, setBidding] = useState<Requisition | null>(null);
  const [viewing, setViewing] = useState<Requisition | null>(null);
  const [editing, setEditing] = useState<Requisition | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const { data, error, loading, reload } = useApi(
    () => requisitionApi.list(statusFilter ? { status: statusFilter } : undefined),
    [statusFilter],
  );
  const action = useAction(reload);

  const isHod = hasRole('HOD');
  const canRaise = user?.role === 'REQUESTER';
  const nextStep = (pr: Requisition) => pr.approvals?.find((a) => a.status === 'PENDING');
  const isMyStep = (pr: Requisition) => {
    if (pr.status !== 'SUBMITTED') return false;
    const step = nextStep(pr);
    return step ? hasRole(step.role) : isHod;
  };

  /** The requester may edit until the HOD approves. A rejected PR goes back to them to revise. */
  const isEditable = (pr: Requisition) =>
    pr.status === 'DRAFT' || pr.status === 'REJECTED' || (pr.status === 'SUBMITTED' && !pr.approvals?.some((a) => a.role === 'HOD' && a.status === 'APPROVED'));

  const actionsFor = (pr: Requisition) => {
    const own = pr.requester._id === user?._id;
    const buttons: JSX.Element[] = [];
    const add = (label: string, run: () => Promise<unknown>, done: string, tone = '') =>
      buttons.push(
        <button
          key={label}
          className={`btn btn-sm ${tone}`}
          disabled={action.busy}
          onClick={() => void action.run(run, done)}
        >
          {label}
        </button>,
      );
    const addWithReason = (label: string, title: string, run: (reason: string) => Promise<unknown>, done: string, tone = '', confirmLabel = label) =>
      buttons.push(
        <button
          key={label}
          className={`btn btn-sm ${tone}`}
          disabled={action.busy}
          onClick={async () => {
            const reason = await askReason(title, 3, confirmLabel);
            if (reason) void action.run(() => run(reason), done);
          }}
        >
          {label}
        </button>,
      );

    if (own && pr.status === 'DRAFT') add('Submit', () => requisitionApi.submit(pr._id), `${pr.prNumber} submitted for approval`, 'btn-primary');
    if (own && isEditable(pr)) {
      buttons.push(
        <button key="edit" className="btn btn-sm" disabled={action.busy} onClick={() => setEditing(pr)}>
          Edit
        </button>,
      );
    }
    if (own && !isHod && ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(pr.status)) {
      addWithReason('Cancel', `Cancel ${pr.prNumber}`, (r) => requisitionApi.cancel(pr._id, r), `${pr.prNumber} cancelled`, 'btn-danger', 'Cancel PR');
    }
    if (isMyStep(pr) && !own) {
      add('Approve', () => requisitionApi.approve(pr._id), `${pr.prNumber} approved`, 'btn-primary');
      addWithReason('Reject', `Reject ${pr.prNumber}`, (r) => requisitionApi.reject(pr._id, r), `${pr.prNumber} rejected`);
    }
    if (pr.rfq && hasRole('PROCUREMENT', 'AUDITOR')) {
      // The RFQ exists: say so, and open that exact RFQ instead of offering a second one.
      buttons.push(
        <span key="rfq-status" className="badge badge-blue">
          RFQ Initiated
        </span>,
        <button key="rfq-view" className="btn btn-sm" onClick={() => navigate(`/sourcing?rfq=${pr.rfq}`)}>
          View RFQ
        </button>,
      );
    } else if (hasRole('PROCUREMENT') && user?.role !== 'AUDITOR') {
      const why = pr.status === 'APPROVED' ? '' : `The PR must be approved first (it is ${pr.status.toLowerCase()})`;
      buttons.push(
        <button key="bid" className="btn btn-sm btn-primary" disabled={action.busy || !!why} title={why} onClick={() => setBidding(pr)}>
          Initiate RFQ
        </button>,
      );
    }
    if (hasRole('PROCUREMENT') && pr.isEmergency && pr.status === 'APPROVED') {
      buttons.push(
        <button key="buy" className="btn btn-sm btn-primary" disabled={action.busy} onClick={() => setBuying(pr)}>
          Buy now
        </button>,
      );
    }
    if (isHod && ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(pr.status)) {
      addWithReason('Cancel', `Cancel ${pr.prNumber}`, (r) => requisitionApi.cancel(pr._id, r), `${pr.prNumber} cancelled`, 'btn-danger', 'Cancel PR');
    }
    return buttons;
  };

  const isLockedForMe = (pr: Requisition) => !!pr.pendingAt && pr.pendingAt.role !== user?.role && user?.role !== 'ADMIN' && !isMyStep(pr);

  return (
    <Page
      title="Purchase Requisitions"
      actions={
        <>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SOURCING', 'PO_CREATED', 'CANCELLED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          {canRaise && !showForm && (
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              + New PR
            </button>
          )}
        </>
      }
    >
      {showForm && (
        <Modal title="New purchase requisition" onClose={() => setShowForm(false)} extraWide dismissible={false}>
          <RequisitionForm
            onCancel={() => setShowForm(false)}
            onCreated={() => {
              setShowForm(false);
              return reload();
            }}
          />
        </Modal>
      )}
      {viewing && (
        <Modal title={`${viewing.prNumber}: ${viewing.title}`} onClose={() => setViewing(null)} extraWide>
          <PrDetail pr={viewing} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit ${editing.prNumber}`} onClose={() => setEditing(null)} extraWide dismissible={false}>
          <RequisitionForm
            pr={editing}
            onCancel={() => setEditing(null)}
            onCreated={() => {
              setEditing(null);
              return reload();
            }}
          />
        </Modal>
      )}
      {bidding && (
        <Modal title={`Initiate RFQ: ${bidding.prNumber}`} onClose={() => setBidding(null)} extraWide dismissible={false}>
          <CreateRfqForm
            fromPr={bidding}
            onCancel={() => setBidding(null)}
            onCreated={() => {
              setBidding(null);
              return reload();
            }}
          />
        </Modal>
      )}
      <ErrorBanner message={error ?? action.error} onClose={action.clearError} />
      {loading && !data ? (
        <Empty>Loading…</Empty>
      ) : !data?.length ? (
        <Empty>No requisitions found.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>PR #</th>
              <th>Title</th>
              <th>Items</th>
              <th>Department</th>
              <th>Requester</th>
              <th>Priority</th>
              <th className="num">Estimate</th>
              <th>Approvals</th>
              <th>Created</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((pr) => (
              <tr key={pr._id}>
                <td className="mono">
                  <button className="link" onClick={() => setViewing(pr)} title="Open the PR, its journey and conversation">
                    {pr.prNumber}
                  </button>
                  {pr.isEmergency && <div><span className="badge badge-red">EMERGENCY</span></div>}
                </td>
                <td>
                  {pr.title}
                  {pr.isEmergency && pr.emergencyReason && <div className="muted small">{pr.emergencyReason}</div>}
                </td>
                <td>
                  <ul className="item-list">
                    {pr.items.map((i) => (
                      <li key={i._id} title={`${ITEM_TYPE_LABELS[i.itemType ?? 'GOODS']}: ${i.description}`}>
                        <strong>{productName(i)}</strong> × {i.quantity} {i.uom}
                        {i.title && <div className="muted small">{i.description}</div>}
                      </li>
                    ))}
                  </ul>
                </td>
                <td>{pr.department?.code}</td>
                <td>{pr.requester?.name}</td>
                <td>{pr.priority}</td>
                <td className="num">{formatMoney(pr.totalEstimate)}</td>
                <td>
                  <div className="chain">
                    {pr.approvals?.map((a) => (
                      <span key={a.level} className={`chain-step chain-${a.status.toLowerCase()}`} title={a.remarks}>
                        L{a.level} {a.role}
                      </span>
                    ))}
                  </div>
                </td>
                <td>{formatDate(pr.createdAt)}</td>
                <td>
                  <StatusBadge status={pr.status} />
                  {pr.ratification?.status && <div className="muted small">Ratification: {pr.ratification.status.toLowerCase()}</div>}
                </td>
                <td>
                  <div className="row-actions">{actionsFor(pr)}</div>
                  {isLockedForMe(pr) && <LockBanner pendingAt={pr.pendingAt} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {buying && <EmergencyPurchaseDialog pr={buying} onClose={() => setBuying(null)} onDone={reload} />}
    </Page>
  );
}
