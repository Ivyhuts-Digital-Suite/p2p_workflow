import { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { OverlayHost } from './components/overlays';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import { AdminPage } from './pages/admin/AdminPage';
import { AuditPage } from './pages/audit/AuditPage';
import { DashboardPage } from './pages/DashboardPage';
import { GoodsReceiptPage } from './pages/grn/GoodsReceiptPage';
import { ServiceEntriesPage } from './pages/grn/ServiceEntriesPage';
import { InvoicesPage } from './pages/invoices/InvoicesPage';
import { LoginPage } from './pages/LoginPage';
import { PurchaseOrdersPage } from './pages/purchase-orders/PurchaseOrdersPage';
import { RequisitionsPage } from './pages/requisitions/RequisitionsPage';
import { SignupPage } from './pages/SignupPage';
import { BiddingDashboardPage } from './pages/sourcing/BiddingDashboardPage';
import { SourcingPage } from './pages/sourcing/SourcingPage';
import { VendorRfqsPage } from './pages/sourcing/VendorRfqsPage';
import { TreasuryPage } from './pages/treasury/TreasuryPage';
import { VendorProfilePage } from './pages/vendors/VendorProfilePage';
import { VendorsPage } from './pages/vendors/VendorsPage';
import type { Role } from './types';

const guard = (roles: Role[], element: ReactNode) => <ProtectedRoute roles={roles}>{element}</ProtectedRoute>;

export default function App() {
  return (
    <AuthProvider>
      <OverlayHost />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="requisitions" element={guard(['REQUESTER', 'HOD', 'PROCUREMENT', 'FINANCE', 'AUDITOR'], <RequisitionsPage />)} />
            <Route path="vendors" element={guard(['PROCUREMENT', 'AUDITOR'], <VendorsPage />)} />
            <Route path="sourcing" element={guard(['PROCUREMENT', 'AUDITOR'], <SourcingPage />)} />
            <Route path="bidding-dashboard" element={guard(['PROCUREMENT', 'AUDITOR'], <BiddingDashboardPage />)} />
            <Route path="vendor/rfqs" element={guard(['VENDOR'], <VendorRfqsPage />)} />
            <Route path="vendor/profile" element={guard(['VENDOR'], <VendorProfilePage />)} />
            <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
            <Route path="grn" element={guard(['STORE', 'AUDITOR'], <GoodsReceiptPage />)} />
            <Route path="service-entries" element={guard(['REQUESTER', 'HOD', 'STORE', 'PROCUREMENT', 'AUDITOR', 'VENDOR'], <ServiceEntriesPage />)} />
            <Route path="invoices" element={guard(['FINANCE', 'AUDITOR', 'VENDOR'], <InvoicesPage />)} />
            <Route path="treasury" element={guard(['FINANCE', 'AUDITOR'], <TreasuryPage />)} />
            <Route path="audit" element={guard(['AUDITOR'], <AuditPage />)} />
            <Route path="admin" element={guard(['ADMIN', 'AUDITOR'], <AdminPage />)} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
