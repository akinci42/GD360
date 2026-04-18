import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore.js';

export default function DashboardPage() {
  const { t } = useTranslation();
  const user = useAuthStore(s => s.user);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-100 mb-1">{t('nav.dashboard')}</h1>
      <p className="text-slate-400 mb-8">Hoş geldiniz, {user?.full_name}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Aktif Müşteriler', value: '—' },
          { label: 'Pipeline Fırsatları', value: '—' },
          { label: 'Bu Ay Teklif', value: '—' },
          { label: 'Bekleyen Aktiviteler', value: '—' },
        ].map(card => (
          <div key={card.label} className="card">
            <p className="text-sm text-slate-400">{card.label}</p>
            <p className="text-3xl font-bold text-slate-100 mt-2">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
