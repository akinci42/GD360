import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore.js';
import api from '../utils/api.js';

const MONTHS = [
  { v: 0, tr: 'Tüm Yıl', en: 'Full Year' },
  { v: 1, tr: 'Ocak',    en: 'Jan' }, { v: 2, tr: 'Şubat',  en: 'Feb' },
  { v: 3, tr: 'Mart',    en: 'Mar' }, { v: 4, tr: 'Nisan',  en: 'Apr' },
  { v: 5, tr: 'Mayıs',   en: 'May' }, { v: 6, tr: 'Haziran',en: 'Jun' },
  { v: 7, tr: 'Temmuz',  en: 'Jul' }, { v: 8, tr: 'Ağustos',en: 'Aug' },
  { v: 9, tr: 'Eylül',   en: 'Sep' }, { v: 10,tr: 'Ekim',   en: 'Oct' },
  { v: 11,tr: 'Kasım',   en: 'Nov' }, { v: 12,tr: 'Aralık', en: 'Dec' },
];

function fmt(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000)     return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toLocaleString()}`;
}

function WinRate({ won, total }) {
  const rate = total > 0 ? Math.round((won / total) * 100) : 0;
  const color = rate >= 50 ? 'text-emerald-400' : rate >= 30 ? 'text-yellow-400' : 'text-red-400';
  return <span className={`font-bold ${color}`}>{rate}%</span>;
}

function Bar({ value, max }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
      <div className="h-full bg-brand-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function PerformansPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const isManager = ['owner', 'coordinator'].includes(user?.role);

  const [year,  setYear]  = useState(new Date().getFullYear());
  const [month, setMonth] = useState(0);
  const [data,  setData]  = useState([]);
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const params = { year };
        if (month > 0) params.month = month;
        const [perfRes, trendRes] = await Promise.all([
          api.get('/reports/performance', { params }),
          api.get('/reports/pipeline-trends', { params: { months: 12 } }),
        ]);
        setData(perfRes.data.data);
        setTrends(trendRes.data.data);
      } catch { /* handled */ } finally { setLoading(false); }
    }
    load();
  }, [year, month]);

  const maxRevenue = Math.max(...data.map(d => Number(d.won_revenue) || 0), 1);

  const years = [new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">{t('performance.title')}</h1>
        <div className="flex gap-2">
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="bg-dark-800 border border-dark-700 text-slate-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand-500"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            className="bg-dark-800 border border-dark-700 text-slate-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand-500"
          >
            {MONTHS.map(m => <option key={m.v} value={m.v}>{m.tr}</option>)}
          </select>
        </div>
      </div>

      {/* Summary KPIs */}
      {data.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: t('performance.totalRevenue'), value: fmt(data.reduce((s, d) => s + Number(d.won_revenue), 0)), cls: 'text-emerald-400' },
            { label: t('performance.totalWon'),     value: data.reduce((s, d) => s + Number(d.won_count), 0),        cls: 'text-slate-200'  },
            { label: t('performance.activeDeals'),  value: data.reduce((s, d) => s + Number(d.opportunity_count) - Number(d.won_count) - Number(d.lost_count), 0), cls: 'text-brand-400' },
            { label: t('performance.teamSize'),     value: data.length,                                              cls: 'text-slate-200'  },
          ].map(k => (
            <div key={k.label} className="bg-dark-800 border border-dark-700 rounded-xl p-4 text-center">
              <p className={`text-2xl font-bold ${k.cls}`}>{k.value}</p>
              <p className="text-xs text-slate-500 mt-1">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Leaderboard table */}
      <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-700">
          <h2 className="text-sm font-semibold text-slate-200">{t('performance.leaderboard')}</h2>
        </div>
        {loading ? (
          <div className="text-center py-12 text-slate-500">{t('common.loading')}</div>
        ) : data.length === 0 ? (
          <div className="text-center py-12 text-slate-600">{t('common.noData')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-dark-700">
                  <th className="text-left px-4 py-2.5 font-medium">#</th>
                  <th className="text-left px-4 py-2.5 font-medium">{t('performance.salesperson')}</th>
                  <th className="text-left px-4 py-2.5 font-medium">{t('performance.region')}</th>
                  <th className="text-right px-4 py-2.5 font-medium">{t('performance.revenue')}</th>
                  <th className="text-center px-4 py-2.5 font-medium">{t('performance.won')}</th>
                  <th className="text-center px-4 py-2.5 font-medium">{t('performance.lost')}</th>
                  <th className="text-center px-4 py-2.5 font-medium">{t('performance.winRate')}</th>
                  <th className="text-center px-4 py-2.5 font-medium">{t('performance.activities')}</th>
                  <th className="px-4 py-2.5 w-32" />
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700/50">
                {data.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-dark-700/30 transition-colors">
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-brand-700/60 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-brand-200">{row.full_name?.charAt(0)}</span>
                        </div>
                        <span className="text-slate-200 font-medium">{row.full_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{row.region || '—'}</td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-400">{fmt(row.won_revenue)}</td>
                    <td className="px-4 py-3 text-center text-emerald-400 font-medium">{row.won_count}</td>
                    <td className="px-4 py-3 text-center text-red-400">{row.lost_count}</td>
                    <td className="px-4 py-3 text-center">
                      <WinRate won={Number(row.won_count)} total={Number(row.won_count) + Number(row.lost_count)} />
                    </td>
                    <td className="px-4 py-3 text-center text-slate-400">{row.followup_count}</td>
                    <td className="px-4 py-3">
                      <Bar value={Number(row.won_revenue)} max={maxRevenue} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Monthly trend */}
      {trends.length > 0 && (
        <div className="bg-dark-800 border border-dark-700 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">{t('performance.trend')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-slate-400">
              <thead>
                <tr className="text-slate-500 border-b border-dark-700">
                  <th className="text-left pb-2 font-medium">{t('performance.month')}</th>
                  <th className="text-center pb-2 font-medium">{t('performance.active')}</th>
                  <th className="text-center pb-2 font-medium">{t('performance.won')}</th>
                  <th className="text-center pb-2 font-medium">{t('performance.lost')}</th>
                  <th className="text-right pb-2 font-medium">{t('performance.revenue')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700/30">
                {trends.map(row => (
                  <tr key={row.month} className="hover:bg-dark-700/20">
                    <td className="py-2 font-mono">{row.month}</td>
                    <td className="py-2 text-center text-brand-400">{row.active}</td>
                    <td className="py-2 text-center text-emerald-400">{row.won}</td>
                    <td className="py-2 text-center text-red-400">{row.lost}</td>
                    <td className="py-2 text-right text-slate-300">{fmt(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
