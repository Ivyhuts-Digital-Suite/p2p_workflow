import { FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { authApi } from '../api/services';
import { PortalLayout, RoleCards } from '../components/RolePortal';
import { ErrorBanner } from '../components/ui';
import { RoleCardConfig } from '../config/roles';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import type { Role } from '../types';

const EMPTY = {
  name: '',
  companyName: '',
  contactPerson: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
  gstin: '',
  pan: '',
  categories: '',
  department: '',
  registrationCode: '',
};

const OPTIONS_RETRY_MS = 5000;
const NEEDS_DEPARTMENT: Role[] = ['REQUESTER', 'HOD'];
const SINGLE_ACCOUNT: Role[] = ['ADMIN', 'AUDITOR', 'FINANCE', 'STORE'];

/**
 * Sign-up driven by the selected role card. Vendors register freely with their tax details.
 * Internal roles fall under the Single Master Account Policy, which the API enforces; the
 * disabled cards here only save a person from filling in a form that would be refused.
 */
export function SignupPage() {
  const { user, registerVendor, registerInternal } = useAuth();
  const navigate = useNavigate();
  const options = useApi(() => authApi.signupOptions());
  const [card, setCard] = useState<RoleCardConfig | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The role cards depend on these options, so keep trying if the API was unavailable.
  const { error: optionsError, reload: reloadOptions } = options;
  useEffect(() => {
    if (!optionsError) return;
    const timer = window.setTimeout(() => void reloadOptions(), OPTIONS_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [optionsError, reloadOptions]);

  if (user) return <Navigate to="/" replace />;

  const set = (field: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const isClaimed = (r: Role) => !!options.data?.claimedRoles.includes(r);
  const hodDepartments = options.data?.departments.filter((d) => !d.hodClaimed) ?? [];
  const noDepartments = options.data?.departments.length === 0;
  const needsMissingDepartment = (c: RoleCardConfig) => noDepartments && c.roles.some((r) => NEEDS_DEPARTMENT.includes(r));
  const masterTaken = (c: RoleCardConfig) =>
    c.roles.every((r) => isClaimed(r)) || (c.key === 'hod' && !!options.data && !noDepartments && hodDepartments.length === 0);

  const selectCard = (next: RoleCardConfig) => {
    void options.reload(); // departments and claimed roles can change while this page is open
    setCard(next);
    setRole(next.roles.find((r) => !isClaimed(r)) ?? next.roles[0]);
    setError(null);
  };

  const isVendor = role === 'VENDOR';
  const departments = role === 'HOD' ? hodDepartments : options.data?.departments ?? [];

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!role) return;
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isVendor) {
        await registerVendor({
          companyName: form.companyName,
          contactPerson: form.contactPerson,
          email: form.email,
          phone: form.phone,
          password: form.password,
          gstin: form.gstin,
          pan: form.pan,
          categories: form.categories.split(',').map((c) => c.trim()).filter(Boolean),
        });
        navigate('/', { replace: true });
        return;
      }
      const { message, signedIn } = await registerInternal({
        role,
        name: form.name,
        email: form.email,
        password: form.password,
        department: form.department || undefined,
        registrationCode: form.registrationCode || undefined,
      });
      if (signedIn) navigate('/', { replace: true });
      else setDone(message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <PortalLayout selected={card?.key ?? null}>
        <h1>Account created</h1>
        <div className="alert alert-info">{done}</div>
        <Link className="btn btn-primary" to="/login">
          Back to sign in
        </Link>
      </PortalLayout>
    );
  }

  const internalClosed = !isVendor && options.data && !options.data.internalSignupEnabled;

  return (
    <PortalLayout selected={card?.key ?? null}>
      <h1>Create an account</h1>
      <p className="muted">Select the role you are registering for</p>
      <ErrorBanner message={options.error} />
      {noDepartments && (
        <div className="alert alert-info">
          No departments have been set up yet. An administrator needs to add one under Administration before Requesters and Heads of Department can
          sign up.
        </div>
      )}
      <RoleCards
        selected={card?.key ?? null}
        onSelect={selectCard}
        isDisabled={(c) => masterTaken(c) || needsMissingDepartment(c)}
        note={(c) => (masterTaken(c) ? 'Master account already exists' : needsMissingDepartment(c) ? 'Waiting for a department to be added' : undefined)}
      />
      {card && role && (
        <form className="portal-form" onSubmit={onSubmit}>
          <h2>{card.fullName}</h2>
          <ErrorBanner message={error} onClose={() => setError(null)} />
          {internalClosed ? (
            <div className="alert alert-info">Internal self sign-up is disabled. Ask your administrator for an account.</div>
          ) : (
            <>
              <div className="grid-2">
                {isVendor ? (
                  <>
                    <label>
                      Company name *
                      <input value={form.companyName} onChange={set('companyName')} required minLength={2} />
                    </label>
                    <label>
                      Contact person *
                      <input value={form.contactPerson} onChange={set('contactPerson')} required minLength={2} />
                    </label>
                  </>
                ) : (
                  <label>
                    Full name *
                    <input value={form.name} onChange={set('name')} required minLength={2} />
                  </label>
                )}
                <label>
                  Email *
                  <input type="email" value={form.email} onChange={set('email')} required />
                </label>
                {isVendor && (
                  <>
                    <label>
                      Phone *
                      <input type="tel" value={form.phone} onChange={set('phone')} required />
                    </label>
                    <label>
                      PAN *
                      <input value={form.pan} onChange={set('pan')} placeholder="AABCU9603R" maxLength={10} required />
                    </label>
                    <label>
                      GSTIN *
                      <input value={form.gstin} onChange={set('gstin')} placeholder="27AABCU9603R1ZM" maxLength={15} required />
                    </label>
                  </>
                )}
                {NEEDS_DEPARTMENT.includes(role) && (
                  <label>
                    Department *
                    <select value={form.department} onChange={set('department')} required>
                      <option value="">Select department…</option>
                      {departments.map((d) => (
                        <option key={d._id} value={d._id}>
                          {d.name} ({d.code})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Password * <span className="muted small">(min 8 characters)</span>
                  <input type="password" value={form.password} onChange={set('password')} required minLength={8} />
                </label>
                <label>
                  Confirm password *
                  <input type="password" value={form.confirmPassword} onChange={set('confirmPassword')} required minLength={8} />
                </label>
                {!isVendor && options.data?.registrationCodeRequired && (
                  <label>
                    Registration code *
                    <input value={form.registrationCode} onChange={set('registrationCode')} required />
                  </label>
                )}
              </div>
              {isVendor ? (
                <label>
                  Supply categories <span className="muted small">(comma separated, optional)</span>
                  <input value={form.categories} onChange={set('categories')} placeholder="IT Hardware, Networking" />
                </label>
              ) : (
                <p className="muted small">
                  {SINGLE_ACCOUNT.includes(role)
                    ? 'Only one account can exist for this role. '
                    : role === 'HOD'
                      ? 'Only one Head of Department account can exist per department. '
                      : ''}
                  {role !== 'ADMIN' && 'An administrator must activate the account before you can sign in.'}
                </p>
              )}
              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Creating account…' : 'Create account'}
              </button>
            </>
          )}
        </form>
      )}
      <p className="muted small">
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </PortalLayout>
  );
}
