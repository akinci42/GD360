import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../utils/api.js';
import { useAuthStore } from '../store/authStore.js';

const TYPE_LABELS = {
  call: '📞 Arama',
  email: '📧 E-posta',
  meeting: '🤝 Toplantı',
  demo: '🖥️ Demo',
  site_visit: '🏭 Saha Ziyareti',
  other: '📌 Diğer',
};

export default function ActivitiesPage() {
  const { t } = useTranslation();
  const user = useAuthStore(s => s.user);
  const [followups, setFollowups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');

  useEffect(() => {
    api.get('/followups', { params: { completed: filter === 'completed' ? 'true' : 'false', limit: 50 } })
      .then(r => setFollowups(r.data.data))
      .finally(() => setLoading(false));
  }, [filter]);

  function isLocked(f) {
    return f.locked_until && new Date(f.locked_until) > new Date() && f.locked_by !== user.id;
  }

  async function complete(id) {
    await api.post(`/followups/${id}/complete`);
    setFollowups(prev => prev.filter(f => f.id !== id));
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-100">{t('nav.activities')}</h1>
        <button className="btn-primary">{t('common.add')} Aktivite</button>
      </div>

      <div className="flex gap-2 mb-4">
        {['pending', 'completed'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f ? 'bg-brand-600 text-white' : 'bg-dark-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {f === 'pending' ? 'Bekleyenler' : 'Tamamlananlar'}
          </button>
        ))}
      </div>

      {loading && <p className="text-slate-400">{t('common.loading')}</p>}

      <div className="space-y-2">
        {followups.map(f => {
          const locked = isLocked(f);
          return (
            <div key={f.id} className={`card flex items-start gap-4 ${locked ? 'opacity-70' : ''}`}>
              <div className="flex-shrink-0 text-lg">{TYPE_LABELS[f.type]?.split(' ')[0] || '📌'}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-slate-100 truncate">{f.subject}</p>
                  {locked && (
                    <span className="text-xs bg-yellow-900/40 text-yellow-400 px-2 py-0.5 rounded-full flex-shrink-0">
                      🔒 Kilitli
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {TYPE_LABELS[f.type]} · {new Date(f.scheduled_at).toLocaleString('tr-TR')}
                </p>
                {f.notes && <p className="text-sm text-slate-400 mt-1 line-clamp-2">{f.notes}</p>}
                {locked && (
                  <p className="text-xs text-yellow-500 mt-1">
                    Kilit bitiş: {new Date(f.locked_until).toLocaleString('tr-TR')} · {f.locked_by_name}
                  </p>
                )}
              </div>
              {!f.completed_at && !locked && (
                <button
                  onClick={() => complete(f.id)}
                  className="btn-secondary text-xs flex-shrink-0"
                >
                  ✓ Tamamla
                </button>
              )}
            </div>
          );
        })}
        {!loading && followups.length === 0 && (
          <p className="text-center py-12 text-slate-500">{t('common.noData')}</p>
        )}
      </div>
    </div>
  );
}
