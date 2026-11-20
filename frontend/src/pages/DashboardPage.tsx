import { Link } from 'react-router-dom';
import { poApi, treasuryApi } from '../api/services';
import { askReason } from '../components/overlays';
import { JourneyPath, PriceBreakdown } from '../components/Workflow';
import { ROLE_LABELS, navItemsFor } from '../config/navigation';
import { useAuth } from '../context/AuthContext';
import { Card, ErrorBanner, Page, Stat } from '../components/ui';
import { useAction, useApi } from '../hooks/useApi';
import { formatMoney, productName } from '../utils/format';
import type { Role } from '../types';

const ROLE_GUIDE: Record<Role, string[]> = {
  REQUESTER: ['Raise purchase requisitions against your department budget', 'Submit drafts for HOD approval and track their status', 'Record completed services for your HOD to accept'],
  HOD: ['Approve or reject PRs from your department (commits budget)', 'Cancel PRs', 'Approve POs and high-value payments at the HOD level', 'Accept service and commissioning sign-offs'],
  PROCUREMENT: ['Turn approved PRs into RFQs and invite vendors', 'Compare bids as they arrive and select a vendor (a non-L1 choice needs a written justification)', 'Selecting a vendor generates the PO: within your authority it is approved and issued at once', 'Verify vendor licences'],
  STORE: ['Count boxes and inspect quality and damage on arrival', 'Post the Goods Receipt Note with batch, expiry and serial numbers: what you accept enters stock', 'Send rejected goods back on a return note'],
  FINANCE: ['Review the 3-way match (PO vs GRN vs Invoice, 2% price tolerance), decide exceptions and record debit and credit notes', 'Book liability, then verify GSTIN, PAN and TDS', 'Release payments, and retry or check any the bank has not confirmed', 'Decide budget escalations and emergency ratifications, and final DoA approval for high-value POs and PRs'],
  AUDITOR: ['Read every module, the audit trail, match logs and compliance records', 'You cannot approve orders or release payments'],
  VENDOR: ['Add your bank details and licences under Company Profile so Procurement can approve you', 'Bid on RFQs you are invited to', 'See the POs awarded to you and submit invoices against them'],
  ADMIN: ['Oversight of every module', 'Manage users, departments, budgets and DoA rules under Administration'],
};

const FLOW = ['PR & budget lock', 'Sourcing & bidding', 'PO & DoA approval', 'Store GRN & inspection', 'Finance 3-way match', 'Tax & payment release'];

/** High-value payments waiting on the caller's approval, for approvers who don't work in Finance. */
function PaymentApprovals() {
  const { data, error, reload } = useApi(() => treasuryApi.myApprovals());
  const action = useAction(reload);
  if (!data?.length && !error && !action.error) return null;

  return (
    <section className="card" id="payment-approvals">
      <h2>Payments waiting for your approval</h2>
      <ErrorBanner message={error ?? action.error} onClose={action.clearError} />
      <table className="table">
        <thead>
          <tr>
            <th>Payment</th>
            <th>Vendor</th>
            <th>Items</th>
            <th className="num">Actual + Tax = Total</th>
            <th className="num">Net after TDS</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.map((p) => (
            <tr key={p._id}>
              <td className="mono">{p.paymentRef}</td>
              <td>{p.vendor?.companyName}</td>
              <td>{p.invoice?.items?.map(productName).join(', ')}</td>
              <td className="num">
                <PriceBreakdown compact actual={p.invoice?.subtotal} tax={p.invoice?.gstAmount} total={p.invoice?.total} />
              </td>
              <td className="num">
                <strong>{formatMoney(p.netAmount)}</strong>
              </td>
              <td className="row-actions">
                <button
                  className="btn btn-sm btn-primary"
                  disabled={action.busy}
                  onClick={() => void action.run(() => treasuryApi.approve(p._id), `${p.paymentRef} approved`)}
                >
                  Approve
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  disabled={action.busy}
                  onClick={async () => {
                    const reason = await askReason(`Reject ${p.paymentRef}`);
                    if (reason) void action.run(() => treasuryApi.reject(p._id, reason), `${p.paymentRef} rejected`);
                  }}
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const poSummary = useApi(() => poApi.summary());
  if (!user) return null;
  const canApprovePayments = user.role === 'HOD' || user.role === 'ADMIN';
  const links = navItemsFor(user.role).filter((i) => i.path !== '/');

  return (
    <Page title={`Welcome, ${user.name.split(' ')[0]}`}>
      {user.role === 'VENDOR' && user.vendor?.status && user.vendor.status !== 'APPROVED' && (
        <div className="alert alert-info">
          Your vendor profile ({user.vendor.vendorCode}) is <strong>{user.vendor.status}</strong>. Add your bank details under{' '}
          <Link to="/vendor/profile">Company Profile</Link>; Procurement needs them to approve your KYC, and you can bid on RFQs once
          approved.
        </div>
      )}
      <JourneyPath />
      {canApprovePayments && <PaymentApprovals />}
      {poSummary.data && (
        <div className="stats">
          <Stat label="Active POs" value={<Link to="/purchase-orders">{poSummary.data.active}</Link>} />
          <Stat label="Past POs" value={<Link to="/purchase-orders">{poSummary.data.past}</Link>} />
          <Stat label="Waiting for my approval" value={<Link to="/purchase-orders">{poSummary.data.pendingMyApproval}</Link>} />
        </div>
      )}
      <Card title="Procure-to-Pay flow">
        <ol className="flow">
          {FLOW.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Card>
      <div className="grid-2">
        <Card title={`Your role: ${ROLE_LABELS[user.role]}`}>
          <ul>
            {ROLE_GUIDE[user.role].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {user.doaLimit > 0 && user.role !== 'VENDOR' && (
            <p className="muted">Your DoA approval limit: ₹{user.doaLimit.toLocaleString('en-IN')}</p>
          )}
        </Card>
        <Card title="Quick links">
          <div className="quick-links">
            {links.map((l) => (
              <Link key={l.path} to={l.path} className="btn">
                {l.label}
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </Page>
  );
}
