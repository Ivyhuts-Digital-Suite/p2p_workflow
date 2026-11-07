import { FormEvent, useState } from 'react';
import { adminApi } from '../../api/services';
import { askNumber } from '../../components/overlays';
import { Card, Empty, ErrorBanner, Page } from '../../components/ui';
import { ROLE_LABELS } from '../../config/navigation';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApi } from '../../hooks/useApi';
import type { Department, DoaDocumentType, Role } from '../../types';
import { formatDateTime, formatMoney } from '../../utils/format';

const ROLES = Object.keys(ROLE_LABELS) as Role[];
const EMPTY_USER = { name: '', email: '', password: '', role: 'REQUESTER' as Role, department: '', doaLimit: 0 };

function UsersSection({ canEdit, departments }: { canEdit: boolean; departments: Department[] }) {
  const { user: me } = useAuth();
  const { data, error, reload } = useApi(() => adminApi.users());
  const action = useAction(reload);
  const [form, setForm] = useState(EMPTY_USER);
  const [showForm, setShowForm] = useState(false);

  const createUser = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await action.run(() => adminApi.createUser({ ...form, department: form.department || undefined }));
    if (ok) {
      setForm(EMPTY_USER);
      setShowForm(false);
    }
  };

  const editLimit = async (id: string, current: number) => {
    const value = await askNumber('Delegation of Authority limit', current, 'Limit (₹)');
    if (value === null || !Number.isFinite(value) || value < 0) return;
    void action.run(() => adminApi.updateUser(id, { doaLimit: value }), 'Limit updated');
  };

  return (
    <Card title="Users">
      <ErrorBanner message={error ?? action.error} onClose={action.clearError} />
      {canEdit && !showForm && (
        <button className="btn btn-sm" onClick={() => setShowForm(true)}>
          + Add user
        </button>
      )}
      {showForm && (
        <form className="form admin-form" onSubmit={createUser}>
          <div className="grid-3">
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
            </label>
            <label>
              Email
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </label>
            <label>
              Temporary password
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
            </label>
            <label>
              Role
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Department
              <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                <option value="">None</option>
                {departments.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              DoA limit (₹)
              <input type="number" min={0} value={form.doaLimit} onChange={(e) => setForm({ ...form, doaLimit: Number(e.target.value) })} />
            </label>
          </div>
          <div className="form-footer">
            <button className="btn btn-primary" disabled={action.busy}>
              Create user
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {!data?.length ? (
        <Empty>No users.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Dept</th>
              <th className="num">DoA limit</th>
              <th>Last sign-in</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u._id} className={u.isActive ? '' : 'inactive'}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{ROLE_LABELS[u.role]}</td>
                <td>{u.department?.code ?? '-'}</td>
                <td className="num">{u.doaLimit >= Number.MAX_SAFE_INTEGER ? 'No limit' : formatMoney(u.doaLimit)}</td>
                <td>{formatDateTime(u.lastLoginAt)}</td>
                <td>
                  <span className={`badge badge-${u.isActive ? 'green' : 'amber'}`}>{u.isActive ? 'ACTIVE' : 'INACTIVE'}</span>
                </td>
                <td className="row-actions">
                  {canEdit && u._id !== me?._id && (
                    <button className="btn btn-sm" disabled={action.busy} onClick={() => void action.run(() => adminApi.updateUser(u._id, { isActive: !u.isActive }))}>
                      {u.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                  {canEdit && u.role !== 'VENDOR' && (
                    <button className="btn btn-sm" disabled={action.busy} onClick={() => void editLimit(u._id, u.doaLimit)}>
                      Edit limit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function DepartmentsSection({ canEdit, data, reload, loadError }: { canEdit: boolean; data: Department[] | null; reload: () => unknown; loadError: string | null }) {
  const action = useAction(reload);
  const [form, setForm] = useState({ name: '', code: '', fiscalYear: '2026-27', allocated: 0 });
  const [showForm, setShowForm] = useState(false);

  const createDepartment = async (e: FormEvent) => {
    e.preventDefault();
    const { fiscalYear, allocated, ...rest } = form;
    const ok = await action.run(() => adminApi.createDepartment({ ...rest, budget: { fiscalYear, allocated } }));
    if (ok) setShowForm(false);
  };

  const editBudget = async (dept: Department) => {
    const value = await askNumber(`Allocated budget for ${dept.name}`, dept.budget.allocated, 'Budget (₹)');
    if (value === null || !Number.isFinite(value) || value < 0) return;
    void action.run(() => adminApi.updateDepartment(dept._id, { budget: { allocated: value } }), 'Budget updated');
  };

  return (
    <Card title="Departments & budgets">
      <ErrorBanner message={loadError ?? action.error} onClose={action.clearError} />
      {canEdit && !showForm && (
        <button className="btn btn-sm" onClick={() => setShowForm(true)}>
          + Add department
        </button>
      )}
      {showForm && (
        <form className="form admin-form" onSubmit={createDepartment}>
          <div className="grid-3">
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
            </label>
            <label>
              Code
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required minLength={2} maxLength={10} />
            </label>
            <label>
              Fiscal year
              <input value={form.fiscalYear} onChange={(e) => setForm({ ...form, fiscalYear: e.target.value })} required />
            </label>
            <label>
              Allocated budget (₹)
              <input type="number" min={0} value={form.allocated} onChange={(e) => setForm({ ...form, allocated: Number(e.target.value) })} required />
            </label>
          </div>
          <div className="form-footer">
            <button className="btn btn-primary" disabled={action.busy}>
              Create department
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {!data?.length ? (
        <Empty>No departments.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Department</th>
              <th>Head of Department</th>
              <th>FY</th>
              <th className="num">Allocated</th>
              <th className="num">Locked (approved PRs)</th>
              <th className="num">Paid</th>
              <th className="num">Available</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d._id}>
                <td>
                  {d.name} <span className="muted">({d.code})</span>
                </td>
                <td>{d.hod?.name ?? '-'}</td>
                <td>{d.budget.fiscalYear}</td>
                <td className="num">{formatMoney(d.budget.allocated)}</td>
                <td className="num">{formatMoney(d.budget.committed)}</td>
                <td className="num">{formatMoney(d.budget.consumed)}</td>
                <td className="num">{formatMoney(d.budget.allocated - d.budget.committed)}</td>
                <td className="row-actions">
                  {canEdit && (
                    <button className="btn btn-sm" disabled={action.busy} onClick={() => void editBudget(d)}>
                      Edit budget
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function DoaRulesSection({ canEdit }: { canEdit: boolean }) {
  const { data, error, reload } = useApi(() => adminApi.doaRules());
  const action = useAction(reload);
  const [form, setForm] = useState({ name: '', documentType: 'PO' as DoaDocumentType, minAmount: 0, maxAmount: '', chain: 'PROCUREMENT, HOD' });
  const [showForm, setShowForm] = useState(false);

  const createRule = async (e: FormEvent) => {
    e.preventDefault();
    const levels = form.chain
      .split(',')
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean)
      .map((role, index) => ({ level: index + 1, role: role as Role }));
    const ok = await action.run(() =>
      adminApi.createDoaRule({
        name: form.name,
        documentType: form.documentType,
        minAmount: form.minAmount,
        maxAmount: form.maxAmount === '' ? null : Number(form.maxAmount),
        levels,
        isActive: true,
      }),
    );
    if (ok) setShowForm(false);
  };

  return (
    <Card title="Delegation of Authority rules">
      <ErrorBanner message={error ?? action.error} onClose={action.clearError} />
      {canEdit && !showForm && (
        <button className="btn btn-sm" onClick={() => setShowForm(true)}>
          + Add rule
        </button>
      )}
      {showForm && (
        <form className="form admin-form" onSubmit={createRule}>
          <div className="grid-3">
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
            </label>
            <label>
              Applies to
              <select value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value as DoaDocumentType })}>
                <option value="PO">Purchase orders</option>
                <option value="PR">Requisitions (after the HOD)</option>
                <option value="PAYMENT">Payments</option>
              </select>
            </label>
            <label>
              From (₹)
              <input type="number" min={0} value={form.minAmount} onChange={(e) => setForm({ ...form, minAmount: Number(e.target.value) })} required />
            </label>
            <label>
              Up to (₹, blank = no limit)
              <input type="number" min={0} value={form.maxAmount} onChange={(e) => setForm({ ...form, maxAmount: e.target.value })} />
            </label>
          </div>
          <label>
            Approval chain, in order (roles, comma separated)
            <input value={form.chain} onChange={(e) => setForm({ ...form, chain: e.target.value })} required />
          </label>
          <div className="form-footer">
            <button className="btn btn-primary" disabled={action.busy}>
              Create rule
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {!data?.length ? (
        <Empty>No DoA rules.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Rule</th>
              <th>Applies to</th>
              <th className="num">From</th>
              <th className="num">Up to</th>
              <th>Approval chain</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r._id} className={r.isActive ? '' : 'inactive'}>
                <td>{r.name}</td>
                <td>{r.documentType ?? 'PO'}</td>
                <td className="num">{formatMoney(r.minAmount)}</td>
                <td className="num">{r.maxAmount === null ? 'No limit' : formatMoney(r.maxAmount)}</td>
                <td>
                  <div className="chain">
                    {r.levels.map((l) => (
                      <span key={l.level} className="chain-step">
                        L{l.level} {l.role}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className={`badge badge-${r.isActive ? 'green' : 'grey'}`}>{r.isActive ? 'ACTIVE' : 'INACTIVE'}</span>
                </td>
                <td className="row-actions">
                  {canEdit && (
                    <button className="btn btn-sm" disabled={action.busy} onClick={() => void action.run(() => adminApi.updateDoaRule(r._id, { isActive: !r.isActive }))}>
                      {r.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function AdminPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN');
  const departments = useApi(() => adminApi.departments());

  return (
    <Page title="Administration">
      <UsersSection canEdit={canEdit} departments={departments.data ?? []} />
      <DepartmentsSection canEdit={canEdit} data={departments.data} reload={departments.reload} loadError={departments.error} />
      <DoaRulesSection canEdit={canEdit} />
    </Page>
  );
}
