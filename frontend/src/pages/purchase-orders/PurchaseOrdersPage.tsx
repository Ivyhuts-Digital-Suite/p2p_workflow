import { Fragment, useState } from 'react';
import { poApi } from '../../api/services';
import { askReason } from '../../components/overlays';
import { LockBanner, PriceBreakdown } from '../../components/Workflow';
import { Empty, ErrorBanner, Page, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import type { PurchaseOrder } from '../../types';
import { ITEM_TYPE_LABELS } from '../../types';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format';

export function PurchaseOrdersPage() {
  const { user, hasRole } = useAuth();
  const [view, setView] = useState('active');
  const [search, setSearch] = useState('');
  const [myQueue, setMyQueue] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, error, reload } = useApi(
    () => poApi.list({ view, ...(myQueue ? { pendingMyApproval: 'true' } : {}) }),
    [view, myQueue],
  );
  const summary = useApi(() => poApi.summary());
  const action = useAction(async () => {
    await Promise.all([reload(), summary.reload()]);
  });

  const term = search.trim().toLowerCase();
  const rows = data?.filter(
    (po) =>
      !term ||
      [po.poNumber, po.rfq?.rfqNumber, po.vendor?.companyName, po.vendor?.contactPerson, po.department?.code, ...po.items.map((i) => i.description)].some((v) =>
        v?.toLowerCase().includes(term),
      ),
  );
  const tabs = [
    { key: 'active', label: 'Active', count: summary.data?.active },
    { key: 'past', label: 'Past / completed', count: summary.data?.past },
    { key: 'all', label: 'All' },
  ];

  const pendingStep = (po: PurchaseOrder) => po.approvals.find((a) => a.status === 'PENDING');
  const createdByMe = (po: PurchaseOrder) => !!po.createdBy && po.createdBy === user?._id;
  const isMyApproval = (po: PurchaseOrder) => {
    const step = pendingStep(po);
    return po.status === 'PENDING_APPROVAL' && !!step && hasRole(step.role) && !createdByMe(po);
  };

  const askAndRun = async (title: string, confirmLabel: string, run: (reason: string) => Promise<unknown>, done: string) => {
    const reason = await askReason(title, 3, confirmLabel);
    if (reason) void action.run(() => run(reason), done);
  };

  const actionsFor = (po: PurchaseOrder) => {
    const step = pendingStep(po);
    const out: JSX.Element[] = [];
    if (isMyApproval(po) && step) {
      out.push(
        <button key="a" className="btn btn-sm btn-primary" disabled={action.busy} onClick={() => void action.run(() => poApi.approve(po._id), `${po.poNumber}: level ${step.level} approved`)}>
          Approve L{step.level}
        </button>,
        <button key="r" className="btn btn-sm" disabled={action.busy} onClick={() => void askAndRun(`Reject ${po.poNumber}`, 'Reject', (r) => poApi.reject(po._id, r), `${po.poNumber} rejected`)}>
          Reject
        </button>,
      );
    }
    if (hasRole('PROCUREMENT')) {
      if (['PENDING_APPROVAL', 'APPROVED'].includes(po.status)) {
        out.push(
          <button
            key="i"
            className="btn btn-sm btn-primary"
            disabled={action.busy || po.status !== 'APPROVED'}
            title={po.status !== 'APPROVED' ? po.pendingAt?.label : undefined}
            onClick={() => void action.run(() => poApi.issue(po._id), `${po.poNumber} issued to ${po.vendor?.companyName}`)}
          >
            Issue to vendor
          </button>,
        );
      }
      if (['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ISSUED', 'ACKNOWLEDGED'].includes(po.status))
        out.push(
          <button key="c" className="btn btn-sm btn-danger" disabled={action.busy} onClick={() => void askAndRun(`Cancel ${po.poNumber}`, 'Cancel PO', (r) => poApi.cancel(po._id, r), `${po.poNumber} cancelled. Its requisitions are back in the approved pool.`)}>
            Cancel
          </button>,
        );
      if (['ISSUED', 'ACKNOWLEDGED', 'PARTIALLY_RECEIVED'].includes(po.status))
        out.push(
          <button
            key="s"
            className="btn btn-sm"
            disabled={action.busy}
            onClick={() => void askAndRun(`Short-close ${po.poNumber}: nothing more will arrive, and the unused budget is released`, 'Short-close', (r) => poApi.shortClose(po._id, r), `${po.poNumber} short-closed and unused budget released`)}
          >
            Short-close
          </button>,
        );
    }
    if (user?.role === 'VENDOR' && po.status === 'ISSUED')
      out.push(
        <button key="ack" className="btn btn-sm btn-primary" disabled={action.busy} onClick={() => void action.run(() => poApi.acknowledge(po._id), `${po.poNumber} acknowledged`)}>
          Acknowledge
        </button>,
      );
    return out;
  };

  /** The next move, when it belongs to someone else. It reads as a lock only when it really holds this user up. */
  const lockFor = (po: PurchaseOrder) => {
    if (!po.pendingAt || user?.role === 'ADMIN' || isMyApproval(po)) return null;
    if (po.status === 'PENDING_APPROVAL' && createdByMe(po) && po.pendingAt.role === user?.role) {
      return <LockBanner message={`Action locked: Approval pending at another ${po.pendingAt.label} user. You created this PO, so you cannot approve it.`} />;
    }
    if (po.pendingAt.role === user?.role) return null;
    const blocked = po.status === 'PENDING_APPROVAL' || actionsFor(po).length === 0;
    return blocked ? <LockBanner pendingAt={po.pendingAt} /> : <div className="muted small">Next step pending at {po.pendingAt.label}</div>;
  };

  return (
    <Page
      title="Purchase Orders"
      actions={
        <>
          <input type="search" placeholder="Search PO, RFQ, vendor, item…" aria-label="Search purchase orders" value={search} onChange={(e) => setSearch(e.target.value)} />
          {hasRole('PROCUREMENT', 'HOD', 'FINANCE') && (
            <label className="check">
              <input type="checkbox" checked={myQueue} onChange={(e) => setMyQueue(e.target.checked)} /> Pending my approval
            </label>
          )}
        </>
      }
    >
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={view === t.key} className={`tab${view === t.key ? ' tab-active' : ''}`} onClick={() => setView(t.key)}>
            {t.label}
            {t.count !== undefined && ` (${t.count})`}
          </button>
        ))}
      </div>
      <ErrorBanner message={error ?? action.error} onClose={action.clearError} />
      {!rows?.length ? (
        <Empty>{view === 'past' ? 'No past purchase orders.' : 'No purchase orders.'}</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>PO #</th>
              <th>Vendor</th>
              <th>Items</th>
              <th>Dept</th>
              <th className="num">Actual + Tax = Total</th>
              <th className="num">Invoiced</th>
              <th className="num">Paid</th>
              <th>DoA chain</th>
              <th>Created</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((po) => (
              <Fragment key={po._id}>
                <tr>
                  <td className="mono">
                    <button className="link" onClick={() => setExpanded(expanded === po._id ? null : po._id)}>
                      {po.poNumber}
                    </button>
                    {po.isEmergency && <div><span className="badge badge-red">EMERGENCY</span></div>}
                  </td>
                  <td>
                    {po.vendor?.companyName}
                    {po.vendor?.contactPerson && <div className="muted small">{po.vendor.contactPerson}</div>}
                  </td>
                  <td>
                    <ul className="item-list">
                      {po.items.map((i) => (
                        <li key={i._id}>
                          {i.description} × {i.quantity} {i.uom}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>{po.department?.code}</td>
                  <td className="num">
                    <PriceBreakdown compact actual={po.subtotal} tax={po.taxTotal} total={po.grandTotal} />
                  </td>
                  <td className="num">{formatMoney(po.invoicedAmount)}</td>
                  <td className="num">{formatMoney(po.paidAmount)}</td>
                  <td>
                    <div className="chain">
                      {po.approvals.map((a) => (
                        <span key={a.level} className={`chain-step chain-${a.status.toLowerCase()}`} title={a.remarks}>
                          L{a.level} {a.role}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{formatDateTime(po.createdAt)}</td>
                  <td>
                    <StatusBadge status={po.status} />
                    {po.shortClose?.reason && <div className="muted small">{po.shortClose.reason}</div>}
                  </td>
                  <td>
                    <div className="row-actions">{actionsFor(po)}</div>
                    {lockFor(po)}
                  </td>
                </tr>
                {expanded === po._id && (
                  <tr>
                    <td colSpan={11}>
                      {po.rfq && <p className="small">From RFQ <span className="mono">{po.rfq.rfqNumber}</span> · last updated {formatDate(po.updatedAt)}</p>}
                      <table className="table inner">
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>Type</th>
                            <th className="num">Qty</th>
                            <th className="num">Unit price</th>
                            <th className="num">GST %</th>
                            <th className="num">Actual + Tax = Total</th>
                            <th className="num">Received</th>
                            <th className="num">Invoiced</th>
                          </tr>
                        </thead>
                        <tbody>
                          {po.items.map((i) => {
                            const actual = i.quantity * i.unitPrice;
                            const tax = (actual * i.taxRate) / 100;
                            return (
                              <tr key={i._id}>
                                <td>{i.description}</td>
                                <td>{ITEM_TYPE_LABELS[i.itemType ?? 'GOODS']}</td>
                                <td className="num">
                                  {i.quantity} {i.uom}
                                </td>
                                <td className="num">{formatMoney(i.unitPrice)}</td>
                                <td className="num">{i.taxRate}</td>
                                <td className="num">
                                  <PriceBreakdown compact actual={actual} tax={tax} total={actual + tax} />
                                </td>
                                <td className="num">{i.receivedQty}</td>
                                <td className="num">{i.invoicedQty}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}
