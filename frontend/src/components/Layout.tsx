import { NavLink, Outlet } from 'react-router-dom';
import { ROLE_LABELS, navItemsFor } from '../config/navigation';
import { useAuth } from '../context/AuthContext';

export function Layout() {
  const { user, logout } = useAuth();
  if (!user) return null;

  const items = navItemsFor(user.role);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">P2P Platform</div>
        <nav>
          {items.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-name">{user.name}</div>
          <div className="user-role">
            {ROLE_LABELS[user.role]}
            {user.department?.code ? ` · ${user.department.code}` : ''}
            {user.vendor?.companyName ? ` · ${user.vendor.companyName}` : ''}
          </div>
          <button className="btn btn-ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        {user.role === 'AUDITOR' && (
          <div className="readonly-banner">Read-only oversight: auditors can view every module but cannot change, approve or pay anything.</div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
