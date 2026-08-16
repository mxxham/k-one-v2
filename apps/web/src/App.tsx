import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/components/Toast';
import Layout from '@/components/Layout';
import Spinner from '@/components/Spinner';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import DashboardInbound from '@/pages/DashboardInbound';
import DashboardOutbound from '@/pages/DashboardOutbound';
import DashboardInventory from '@/pages/DashboardInventory';
import { departmentHome } from '@/lib/api';
import InboundList from '@/pages/InboundList';
import InboundDetail from '@/pages/InboundDetail';
import OutboundList from '@/pages/OutboundList';
import OutboundDetail from '@/pages/OutboundDetail';
import StockPage from '@/pages/StockPage';
import LedgerPage from '@/pages/LedgerPage';
import PicklistList from '@/pages/PicklistList';
import PicklistDetail from '@/pages/PicklistDetail';
import StockTakeList from '@/pages/StockTakeList';
import StockTakeDetail from '@/pages/StockTakeDetail';
import CycleCountPage from '@/pages/CycleCountPage';
import BinTransferPage from '@/pages/BinTransferPage';
import ReplenishmentPage from '@/pages/ReplenishmentPage';
import WavesPage from '@/pages/WavesPage';
import AsnList from '@/pages/AsnList';
import AsnDetail from '@/pages/AsnDetail';
import ProductsPage from '@/pages/ProductsPage';
import CustomersPage from '@/pages/CustomersPage';
import LocationsPage from '@/pages/LocationsPage';
import ZoningPage from '@/pages/ZoningPage';
import ReportsPage from '@/pages/ReportsPage';
import ImportPage from '@/pages/ImportPage';
import AutoImportPage from '@/pages/AutoImportPage';
import UsersPage from '@/pages/UsersPage';
import ActivityLogPage from '@/pages/ActivityLogPage';
import ResetDataPage from '@/pages/ResetDataPage';

function RequireAuth() {
  const { isAuthenticated, department } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function HomeRedirect() {
  const { department } = useAuth();
  return <Navigate to={departmentHome(department)} replace />;
}

function RequireWrite() {
  const { isAuthenticated, canWrite } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!canWrite) return <Navigate to="/" replace />;
  return <Outlet />;
}

function RequireAdmin() {
  const { isAuthenticated, canAdmin } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!canAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route path="/" element={<HomeRedirect />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/dashboard/inbound" element={<DashboardInbound />} />
                <Route path="/dashboard/outbound" element={<DashboardOutbound />} />
                <Route path="/dashboard/inventory" element={<DashboardInventory />} />
                <Route path="/inbound" element={<InboundList />} />
                <Route path="/inbound/:id" element={<InboundDetail />} />
                <Route path="/outbound" element={<OutboundList />} />
                <Route path="/outbound/:id" element={<OutboundDetail />} />
                <Route path="/stock" element={<StockPage />} />
                <Route path="/ledger" element={<LedgerPage />} />
                <Route path="/picklist" element={<PicklistList />} />
                <Route path="/picklist/:id" element={<PicklistDetail />} />
                <Route path="/waves" element={<WavesPage />} />
                <Route path="/asn" element={<AsnList />} />
                <Route path="/asn/:id" element={<AsnDetail />} />
                <Route path="/stocktake" element={<StockTakeList />} />
                <Route path="/stocktake/:id" element={<StockTakeDetail />} />
                <Route path="/cycle-count" element={<CycleCountPage />} />
                <Route path="/bin-transfer" element={<BinTransferPage />} />
                <Route path="/replenishment" element={<ReplenishmentPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route element={<RequireWrite />}>
                  <Route path="/import" element={<ImportPage />} />
                  <Route path="/import-auto" element={<AutoImportPage />} />
                  <Route path="/products" element={<ProductsPage />} />
                  <Route path="/customers" element={<CustomersPage />} />
                  <Route path="/locations" element={<LocationsPage />} />
                  <Route path="/zoning" element={<ZoningPage />} />
                </Route>
                <Route element={<RequireAdmin />}>
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/activity-log" element={<ActivityLogPage />} />
                  <Route path="/reset-data" element={<ResetDataPage />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
