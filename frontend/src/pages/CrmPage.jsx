import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../utils/api.js';

export default function CrmPage() {
  const { t } = useTranslation();
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get('/customers', { params: { page, limit: 20, search: search || undefined } })
      .then(r => { if (!cancelled) { setCustomers(r.data.data); setTotal(r.data.total); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, search]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{t('nav.crm')}</h1>
          <p className="text-slate-400 text-sm mt-0.5">{total} müşteri</p>
        </div>
        <button className="btn-primary">{t('common.add')} Müşteri</button>
      </div>

      <div className="card mb-4">
        <input
          className="input"
          placeholder={`${t('common.search')}...`}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-700">
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Şirket</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Ülke</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Sektör</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Sorumlu</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Kişiler</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="text-center py-8 text-slate-500">{t('common.loading')}</td></tr>
            )}
            {!loading && customers.length === 0 && (
              <tr><td colSpan={5} className="text-center py-8 text-slate-500">{t('common.noData')}</td></tr>
            )}
            {customers.map(c => (
              <tr key={c.id} className="border-b border-dark-700/50 hover:bg-dark-700/30 transition-colors">
                <td className="px-4 py-3 text-slate-100 font-medium">{c.company_name}</td>
                <td className="px-4 py-3 text-slate-400">{c.country || '—'}</td>
                <td className="px-4 py-3 text-slate-400">{c.industry || '—'}</td>
                <td className="px-4 py-3 text-slate-400">{c.assigned_to_name || '—'}</td>
                <td className="px-4 py-3 text-slate-400">{c.contacts_count || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 20 && (
        <div className="flex justify-center gap-2 mt-4">
          <button className="btn-secondary text-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            {t('common.back')}
          </button>
          <span className="text-slate-400 text-sm py-2">Sayfa {page} / {Math.ceil(total / 20)}</span>
          <button className="btn-secondary text-sm" disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(p => p + 1)}>
            İleri
          </button>
        </div>
      )}
    </div>
  );
}
