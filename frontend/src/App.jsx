import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore.js';
import LoginPage from './pages/LoginPage.jsx';
import MainLayout from './layouts/MainLayout.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import CrmPage from './pages/CrmPage.jsx';
import SalesRadarPage from './pages/SalesRadarPage.jsx';
import ActivitiesPage from './pages/ActivitiesPage.jsx';

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
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="crm" element={<CrmPage />} />
        <Route path="sales-radar" element={<SalesRadarPage />} />
        <Route path="activities" element={<ActivitiesPage />} />
        <Route path="offers" element={<div className="p-6 text-slate-400">Teklifler yakında...</div>} />
        <Route path="orders" element={<div className="p-6 text-slate-400">Siparişler yakında...</div>} />
        <Route path="products" element={<div className="p-6 text-slate-400">Ürünler yakında...</div>} />
        <Route path="reports" element={<div className="p-6 text-slate-400">Raporlar yakında...</div>} />
        <Route path="calendar" element={<div className="p-6 text-slate-400">Takvim yakında...</div>} />
        <Route path="messages" element={<div className="p-6 text-slate-400">Mesajlar yakında...</div>} />
        <Route path="settings" element={<div className="p-6 text-slate-400">Ayarlar yakında...</div>} />
        <Route path="admin" element={<div className="p-6 text-slate-400">Yönetim yakında...</div>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
