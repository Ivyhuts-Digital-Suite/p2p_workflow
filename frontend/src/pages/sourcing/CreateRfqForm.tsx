import { FormEvent, useState } from 'react';
import { sourcingApi, vendorApi } from '../../api/services';
import { ErrorBanner } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import type { Requisition } from '../../types';
import { formatMoney } from '../../utils/format';

const defaultClose = () => {
  const d = new Date(Date.now() + 3 * 86_400_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/**
 * Initiates the RFQ for one PR, filled in with that PR only, and makes it live straight away: either for
 * every vendor, or as a private invitation to vendors the hospital has dealt with before.
 */
export function CreateRfqForm({ onCreated, onCancel, fromPr }: { onCreated: () => unknown; onCancel: () => void; fromPr: Requisition }) {
  const pastVendors = useApi(() => vendorApi.list({ status: 'APPROVED', past: 'true' }));
  const [title, setTitle] = useState(fromPr.title);
  const [vendorIds, setVendorIds] = useState<string[]>([]);
  const [closeAt, setCloseAt] = useState(defaultClose);
  const [technicalEvaluation, setTechnicalEvaluation] = useState(true);
  const { run, error, busy } = useAction(onCreated);

  const toggle = (id: string) => setVendorIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Which button sent the form, read from the event: state set in the same click would not be visible yet.
    const toSelected = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === 'selected';
    void run(
      async () => {
        const rfq = await sourcingApi.createRfq({
          title,
          requisitionIds: [fromPr._id],
          invitedVendorIds: toSelected ? vendorIds : [],
          closeAt: new Date(closeAt).toISOString(),
          technicalEvaluation,
        });
        await sourcingApi.publish(rfq._id);
      },
      toSelected ? `RFQ sent privately to ${vendorIds.length} vendor${vendorIds.length === 1 ? '' : 's'}` : 'RFQ published to all vendors: bidding is live',
    );
  };

  return (
    <form className="form" onSubmit={onSubmit}>
      <ErrorBanner message={error ?? pastVendors.error} />
      <div className="grid-2">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} />
        </label>
        <label>
          Bidding closes
          <input type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} required />
        </label>
      </div>

      <fieldset>
        <legend>Requisition details</legend>
        <table className="table inner">
          <thead>
            <tr>
              <th>Item</th>
              <th>Item code</th>
              <th className="num">Qty</th>
              <th className="num">Est. unit price</th>
              <th className="num">Estimate</th>
            </tr>
          </thead>
          <tbody>
            {fromPr.items.map((i, index) => (
              <tr key={i._id ?? index}>
                <td>
                  {i.title || i.description}
                  {i.title && <div className="muted small">{i.description}</div>}
                </td>
                <td className="mono">{i.itemCode ?? '-'}</td>
                <td className="num">
                  {i.quantity} {i.uom}
                </td>
                <td className="num">{formatMoney(i.estimatedUnitPrice)}</td>
                <td className="num">{formatMoney(i.quantity * i.estimatedUnitPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          {fromPr.prNumber}: {fromPr.department?.name ?? fromPr.department?.code} · {fromPr.requester?.name} · {fromPr.priority}
          {fromPr.justification ? ` · ${fromPr.justification}` : ''} · estimate {formatMoney(fromPr.totalEstimate)}
        </p>
      </fieldset>

      <fieldset>
        <legend>Invite past vendors privately (optional)</legend>
        {!pastVendors.data?.length && <p className="muted">No approved vendors have bid or supplied before.</p>}
        {pastVendors.data?.map((v) => (
          <label key={v._id} className="check">
            <input type="checkbox" checked={vendorIds.includes(v._id)} onChange={() => toggle(v._id)} />
            {v.companyName} <span className="muted">· {v.contactPerson} · ★ {v.rating}</span>
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={technicalEvaluation} onChange={(e) => setTechnicalEvaluation(e.target.checked)} />
        Two-envelope tender: review bids technically before anyone sees the prices
      </label>
      <div className="form-footer">
        <div className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn" value="selected" disabled={busy || vendorIds.length === 0} title={vendorIds.length ? '' : 'Select at least one vendor above'}>
          Send to selected vendors ({vendorIds.length})
        </button>
        <button className="btn btn-primary" value="all" disabled={busy}>
          Publish to all vendors
        </button>
      </div>
    </form>
  );
}
