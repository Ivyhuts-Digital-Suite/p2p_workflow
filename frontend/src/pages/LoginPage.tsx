import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { PortalLayout, RoleCards } from '../components/RolePortal';
import { ErrorBanner } from '../components/ui';
import { DEMO_PASSWORD, ROLE_CARDS, RoleCardConfig, cardForDemoAccount } from '../config/roles';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../types';

const DEMO_ACCOUNTS = ROLE_CARDS.flatMap((c) => c.demoAccounts);

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [card, setCard] = useState<RoleCardConfig | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const signIn = async (signInEmail: string, signInPassword: string, roles?: Role[]) => {
    setBusy(true);
    setError(null);
    try {
      await login(signInEmail, signInPassword, roles);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (card) void signIn(email, password, card.roles);
  };

  const signInAsDemo = (account: string) => {
    const demoCard = cardForDemoAccount(account);
    const demoEmail = `${account}@p2p.local`;
    setCard(demoCard ?? null);
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    void signIn(demoEmail, DEMO_PASSWORD, demoCard?.roles);
  };

  return (
    <PortalLayout selected={card?.key ?? null}>
      <h1>Procure-to-Pay</h1>
      <p className="muted">Select your role and sign in</p>
      <RoleCards selected={card?.key ?? null} onSelect={setCard} />
      <form className="portal-form" onSubmit={onSubmit}>
        <ErrorBanner message={error} onClose={() => setError(null)} />
        <div className="grid-2">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
        </div>
        <button className="btn btn-primary" disabled={busy || !card}>
          {busy ? 'Signing in…' : card ? `Sign in as ${card.shortName}` : 'Select a role to sign in'}
        </button>
      </form>
      <p className="muted small">
        No account yet? <Link to="/signup">Sign up</Link>
      </p>
      {/* Shown in every build, including Vercel. Set VITE_HIDE_DEMO_LOGINS=true at build time to hide them for real users. */}
      {import.meta.env.VITE_HIDE_DEMO_LOGINS !== 'true' && (
        <div className="demo-accounts">
          <p className="muted small">One-click demo sign-in (password: {DEMO_PASSWORD})</p>
          <div className="chips">
            {DEMO_ACCOUNTS.map((a) => (
              <button type="button" key={a} className="chip" disabled={busy} onClick={() => signInAsDemo(a)}>
                {a}
              </button>
            ))}
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
