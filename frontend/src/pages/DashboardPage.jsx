import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore.js';
import api from '../utils/api.js';

const STAGE_ORDER = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'on_hold'];

const STAGE_COLORS = {
  lead:        'bg-slate-500',
  qualified:   'bg-blue-500',
  proposal:    'bg-amber-500',
  negotiation: 'bg-orange-500',
  won:         'bg-emerald-500',
  lost:        'bg-red-500',
  on_hold:     'bg-purple-500',
};

const ACTIVITY_ICONS = {
  call: '📞', email: '✉️', meeting: '🤝', demo: '🖥️', site_visit: '🏭', other: '📋',
};

function fmt(n) {
  if (!n || isNaN(n)) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Number(n).toFixed(0)}`;
}

function KpiCard({ label, value, sub, icon, colorClass }) {
  return (
    <div className="card flex items-start gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
        <span className="text-xl">{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-400 uppercase tracking-wide leading-none">{label}</p>
        <p className="text-2xl font-bold text-slate-100 mt-1 leading-none">{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const user = useAuthStore(s => s.user);
  const [kpis, setKpis]           = useState(null);
  const [pipeline, setPipeline]   = useState([]);
  const [activities, setActivities] = useState([]);
  const [ranking, setRanking]     = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/kpis'),
      api.get('/dashboard/pipeline-summary'),
      api.get('/dashboard/recent-activities'),
      api.get('/dashboard/sales-by-user'),
    ])
      .then(([k, p, a, s]) => {
        setKpis(k.data.data);
        setPipeline(p.data.data);
        setActivities(a.data.data);
        setRanking(s.data.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const activePipelineCount = pipeline
    .filter(s => !['won', 'lost'].includes(s.stage))
    .reduce((a, s) => a + s.count, 0);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <p className="text-slate-400">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">{t('nav.komutaMerkezi')}</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          {t('dashboard.welcome')}, {user?.full_name}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <KpiCard
          label={t('dashboard.totalCustomers')}
          value={kpis?.totalCustomers ?? '—'}
          icon="👥"
          colorClass="bg-brand-600/20"
        />
        <KpiCard
          label={t('dashboard.activeOpportunities')}
          value={kpis?.activeOpportunities ?? '—'}
          icon="📡"
          colorClass="bg-blue-600/20"
        />
        <KpiCard
          label={t('dashboard.pipelineValue')}
          value={kpis ? fmt(kpis.pipelineValue) : '—'}
          icon="💰"
          colorClass="bg-amber-600/20"
        />
        <KpiCard
          label={t('dashboard.wonRate')}
          value={kpis ? `${kpis.wonRate}%` : '—'}
          icon="🏆"
          colorClass="bg-emerald-600/20"
        />
        <KpiCard
          label={t('dashboard.monthlyActivities')}
          value={kpis?.monthlyActivities ?? '—'}
          sub={t('dashboard.thisMonth')}
          icon="⚡"
          colorClass="bg-purple-600/20"
        />
      </div>

      {/* Pipeline Summary */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-200 mb-4">{t('dashboard.pipelineSummary')}</h2>
        <div className="space-y-2.5">
          {STAGE_ORDER.map(stage => {
            const s = pipeline.find(p => p.stage === stage);
            if (!s || s.count === 0) return null;
            const pct = activePipelineCount > 0
              ? Math.max((s.count / activePipelineCount) * 100, 2)
              : 2;
            const i18nKey = stage === 'on_hold' ? 'pipeline.onHold' : `pipeline.${stage}`;
            return (
              <div key={stage} className="flex items-center gap-3">
                <span className="text-xs text-slate-400 w-24 flex-shrink-0">{t(i18nKey)}</span>
                <div className="flex-1 bg-dark-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${STAGE_COLORS[stage] || 'bg-slate-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs text-slate-400 w-28 text-right flex-shrink-0">
                  {s.count} opp · {fmt(s.value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom: Recent Activities + Sales Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activities */}
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">{t('dashboard.recentActivities')}</h2>
          {activities.length === 0 ? (
            <p className="text-sm text-slate-500">{t('dashboard.noActivities')}</p>
          ) : (
            <ul className="space-y-3">
              {activities.map(a => (
                <li key={a.id} className="flex items-start gap-3">
                  <span className="text-base w-6 flex-shrink-0">{ACTIVITY_ICONS[a.type] || '📋'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 truncate">{a.subject}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {a.customer_name || '—'} · {a.user_name || '—'}
                    </p>
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${a.completed_at ? 'bg-emerald-500' : 'bg-amber-400'}`}
                    title={a.completed_at ? 'Tamamlandı' : 'Bekliyor'}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Sales Ranking */}
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">{t('dashboard.salesRanking')}</h2>
          {ranking.length === 0 ? (
            <p className="text-sm text-slate-500">{t('dashboard.noSalesData')}</p>
          ) : (
            <ul className="space-y-3">
              {ranking.map((s, i) => (
                <li key={s.id} className="flex items-center gap-3">
                  <span className={`text-sm font-bold w-5 flex-shrink-0 ${
                    i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-slate-500'
                  }`}>
                    {i + 1}
                  </span>
                  <div className="w-7 h-7 rounded-full bg-brand-700/50 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-brand-200">
                      {s.fullName.charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 leading-none">{s.fullName}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{s.wonCount} won</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-medium text-emerald-400">{fmt(s.wonValue)}</p>
                    <p className="text-xs text-slate-500">pipe: {fmt(s.pipelineValue)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
