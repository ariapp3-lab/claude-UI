import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import App from './App.tsx';
import SuperAdminLayout from './superadmin/SuperAdminLayout.tsx';
import SuperAdminDashboard from './pages/SuperAdminDashboard.tsx';
import SuperAdminTenants from './pages/SuperAdminTenants.tsx';
import SuperAdminTenantsList from './pages/SuperAdminTenantsList.tsx';
import SuperAdminAddTenant from './pages/SuperAdminAddTenant.tsx';
import SuperAdminTenantDetail from './pages/SuperAdminTenantDetail.tsx';
import SuperAdminUsers from './pages/SuperAdminUsers.tsx';
import SuperAdminUserDetail from './pages/SuperAdminUserDetail.tsx';
import SuperAdminAddAdmin from './pages/SuperAdminAddAdmin.tsx';
import SuperAdminManageSuperadmins from './pages/SuperAdminManageSuperadmins.tsx';
import SuperAdminSignupApprovals from './pages/SuperAdminSignupApprovals.tsx';
import SuperAdminSupportQueue from './pages/SuperAdminSupportQueue.tsx';
import SuperAdminSupportIssueDetail from './pages/SuperAdminSupportIssueDetail.tsx';
import SuperAdminLogsAnalytics from './pages/SuperAdminLogsAnalytics.tsx';
import SuperAdminRequestDetail from './pages/SuperAdminRequestDetail.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/superadmin" element={<SuperAdminLayout />}>
          <Route index element={<SuperAdminDashboard />} />
          <Route path="tenants" element={<SuperAdminTenants />} />
          <Route path="tenants-list" element={<SuperAdminTenantsList />} />
          <Route path="add-tenant" element={<SuperAdminAddTenant />} />
          <Route path="edit-tenant/:id" element={<SuperAdminAddTenant />} />
          <Route path="tenants/:tenantId" element={<SuperAdminTenantDetail />} />
          <Route path="users" element={<SuperAdminUsers />} />
          <Route path="users/:userId" element={<SuperAdminUserDetail />} />
          <Route path="add-admin" element={<SuperAdminAddAdmin />} />
          <Route path="super-admins" element={<SuperAdminManageSuperadmins />} />
          <Route path="signup-approvals" element={<SuperAdminSignupApprovals />} />
          <Route path="support-queue" element={<SuperAdminSupportQueue />} />
          <Route path="support-queue/:issueId" element={<SuperAdminSupportIssueDetail />} />
          <Route path="logs-analytics" element={<SuperAdminLogsAnalytics />} />
          <Route path="request-detail" element={<SuperAdminRequestDetail />} />
        </Route>
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
