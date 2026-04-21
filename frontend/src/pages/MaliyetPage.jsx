import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore.js';
import api from '../utils/api.js';

const CURRENCIES = ['USD', 'EUR', 'TRY', 'GBP'];

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700">
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

const EMPTY_FORM = { category_id: '', title: '', amount: '', currency: 'USD', cost_date: new Date().toISOString().slice(0, 10), notes: '' };

export default function MaliyetPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();

  if (!['owner', 'coordinator'].includes(user?.role)) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-400">{t('admin.accessDenied')}</p>
      </div>
    );
  }

  const [costs,      setCosts]      = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary,    setSummary]    = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [showModal,  setShowModal]  = useState(false);
  const [editing,    setEditing]    = useState(null);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);
  const [toast,      setToast]      = useState('');
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [filterCur,  setFilterCur]  = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { year: filterYear };
      if (filterCur) params.currency = filterCur;
      const [costsRes, catsRes, sumRes] = await Promise.all([
        api.get('/costs', { params }),
        api.get('/costs/categories'),
        api.get('/costs/summary', { params: { year: filterYear } }),
      ]);
      setCosts(costsRes.data.data);
      setCategories(catsRes.data.data);
      setSummary(sumRes.data.data);
    } catch { /* handled */ } finally { setLoading(false); }
  }, [filterYear, filterCur]);

  useEffect(() => { load(); }, [load]);

  function openAdd() { setEditing(null); setForm(EMPTY_FORM); setShowModal(true); }
  function openEdit(cost) {
    setEditing(cost);
    setForm({
      category_id: cost.category_id || '',
      title:       cost.title,
      amount:      cost.amount,
      currency:    cost.currency,
      cost_date:   cost.cost_date?.slice(0, 10),
      notes:       cost.notes || '',
    });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, amount: Number(form.amount), category_id: form.category_id || null };
      if (editing) {
        await api.patch(`/costs/${editing.id}`, payload);
      } else {
        await api.post('/costs', payload);
      }
      setShowModal(false);
      showToast(t('costs.toast.saved'));
      load();
    } catch { /* handled */ } finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!confirm(t('costs.deleteConfirm'))) return;
    await api.delete(`/costs/${id}`);
    setCosts(c => c.filter(x => x.id !== id));
    showToast(t('costs.toast.deleted'));
  }

  const years = [new Date().getFullYear(), new Date().getFullYear() - 1];

  // Group totals by category for summary
  const categoryTotals = summary?.byCategory || [];
  const total = costs.reduce((s, c) => s + Number(c.amount), 0);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">{t('costs.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{costs.length} {t('costs.records')}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))}
            className="bg-dark-800 border border-dark-700 text-slate-300 text-sm rounded-lg px-3 py-1.5">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={filterCur} onChange={e => setFilterCur(e.target.value)}
            className="bg-dark-800 border border-dark-700 text-slate-300 text-sm rounded-lg px-3 py-1.5">
            <option value="">{t('costs.allCurrencies')}</option>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={openAdd} className="btn-primary">+ {t('costs.addCost')}</button>
        </div>
      </div>

      {/* Category summary cards */}
      {categoryTotals.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {categoryTotals.slice(0, 6).map(cat => (
            <div key={cat.name} className="bg-dark-800 border border-dark-700 rounded-xl p-3">
              <div className="w-2 h-2 rounded-full mb-2" style={{ backgroundColor: cat.color }} />
              <p className="text-xs text-slate-500 truncate">{cat.name}</p>
              <p className="text-sm font-bold text-slate-200 mt-0.5">
                {Number(cat.total).toLocaleString()} {cat.currency}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-dark-700">
                <th className="text-left px-4 py-3 font-medium">{t('costs.date')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('costs.category')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('costs.costTitle')}</th>
                <th className="text-right px-4 py-3 font-medium">{t('costs.amount')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('costs.addedBy')}</th>
                <th className="text-right px-4 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700/50">
              {loading ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-500">{t('common.loading')}</td></tr>
              ) : costs.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-600">{t('common.noData')}</td></tr>
              ) : costs.map(cost => (
                <tr key={cost.id} className="hover:bg-dark-700/30 transition-colors">
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                    {cost.cost_date?.slice(0, 10)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      {cost.category_color && (
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cost.category_color }} />
                      )}
                      <span className="text-xs text-slate-400">{cost.category_name || '—'}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-200 font-medium max-w-[200px] truncate">{cost.title}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-100">
                    {Number(cost.amount).toLocaleString()} <span className="text-xs text-slate-500">{cost.currency}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{cost.creator_name || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEdit(cost)} className="text-slate-400 hover:text-brand-400 transition-colors">✎</button>
                      <button onClick={() => handleDelete(cost.id)} className="text-slate-400 hover:text-red-400 transition-colors">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {costs.length > 0 && (
              <tfoot>
                <tr className="border-t border-dark-600 bg-dark-700/20">
                  <td colSpan={3} className="px-4 py-3 text-xs text-slate-500 font-medium">{t('costs.total')}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-100">
                    {total.toLocaleString()} {filterCur || ''}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <Modal title={editing ? t('costs.editCost') : t('costs.addCost')} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="form-label">{t('costs.costTitle')}</label>
                <input className="input w-full" value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('costs.category')}</label>
                <select className="input w-full" value={form.category_id}
                  onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
                  <option value="">— {t('costs.noCategory')}</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">{t('costs.date')}</label>
                <input type="date" className="input w-full" value={form.cost_date}
                  onChange={e => setForm(f => ({ ...f, cost_date: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('costs.amount')}</label>
                <input type="number" step="0.01" className="input w-full" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('costs.currency')}</label>
                <select className="input w-full" value={form.currency}
                  onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="form-label">{t('costs.notes')}</label>
                <textarea className="input w-full resize-none" rows={2} value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={saving} className="btn-primary flex-1">
                {saving ? t('common.loading') : t('common.save')}
              </button>
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
