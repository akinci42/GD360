import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore.js';
import LoginPage from './pages/LoginPage.jsx';
import MainLayout from './layouts/MainLayout.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import CrmPage from './pages/CrmPage.jsx';
import SalesRadarPage from './pages/SalesRadarPage.jsx';
import ActivitiesPage from './pages/ActivitiesPage.jsx';
import IletisimBildirimlerPage from './pages/IletisimBildirimlerPage.jsx';
import YonetimPaneliPage from './pages/YonetimPaneliPage.jsx';
import CrmDetailPage from './pages/CrmDetailPage.jsx';
import OffersPage from './pages/OffersPage.jsx';
import ConfiguratorPage from './pages/ConfiguratorPage.jsx';
import FilesPage from './pages/FilesPage.jsx';
import PerformansPage from './pages/PerformansPage.jsx';
import MaliyetPage from './pages/MaliyetPage.jsx';
import UstaBotPage from './pages/UstaBotPage.jsx';

function ProtectedRoute({ children }) {
  const token = useAuthStore(s => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"    element={<DashboardPage />} />
        <Route path="crm"          element={<CrmPage />} />
        <Route path="crm/:id"      element={<CrmDetailPage />} />
        <Route path="sales-radar"  element={<SalesRadarPage />} />
        <Route path="activities"   element={<ActivitiesPage />} />
        <Route path="teklifler"    element={<OffersPage />} />
        <Route path="konfigurator" element={<ConfiguratorPage />} />
        <Route path="dosyalar"     element={<FilesPage />} />
        <Route path="performans"   element={<PerformansPage />} />
        <Route path="iletisim"     element={<IletisimBildirimlerPage />} />
        <Route path="maliyet"      element={<MaliyetPage />} />
        <Route path="yonetim"      element={<YonetimPaneliPage />} />
        <Route path="ustabot"      element={<UstaBotPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
