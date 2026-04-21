import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore.js';
import api from '../utils/api.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n) {
  if (!n || isNaN(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(2)}K`;
  return Number(n).toFixed(2);
}

const STATUS_STYLES = {
  draft:    'bg-slate-500/20 text-slate-300 border border-slate-500/30',
  sent:     'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  accepted: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  rejected: 'bg-red-500/20 text-red-300 border border-red-500/30',
  expired:  'bg-amber-500/20 text-amber-300 border border-amber-500/30',
};

function StatusBadge({ status, t }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[status] || STATUS_STYLES.draft}`}>
      {t(`offers.statuses.${status}`)}
    </span>
  );
}

function Toast({ msg, onDone }) {
  useEffect(() => { const id = setTimeout(onDone, 3000); return () => clearTimeout(id); }, [onDone]);
  return (
    <div className="fixed bottom-6 right-6 bg-emerald-600 text-white text-sm px-4 py-2.5 rounded-lg shadow-xl z-50">
      ✓ {msg}
    </div>
  );
}

// ─── Empty item template ───────────────────────────────────────────────────────
const emptyItem = () => ({ product_name: '', description: '', quantity: 1, unit: 'pcs', unit_price: 0, discount_pct: 0 });

function lineTotal(item) {
  return parseFloat(item.quantity || 0) * parseFloat(item.unit_price || 0) * (1 - parseFloat(item.discount_pct || 0) / 100);
}

// ─── Offer Form Modal ─────────────────────────────────────────────────────────
function OfferModal({ offer, customers, onClose, onSaved, t }) {
  const isEdit = !!offer;
  const [form, setForm] = useState({
    customer_id:   offer?.customer_id || '',
    title:         offer?.title || '',
    currency:      offer?.currency || 'USD',
    validity_days: offer?.validity_days ?? 30,
    notes:         offer?.notes || '',
  });
  const [items, setItems] = useState(
    offer?.items?.length ? offer.items.map(i => ({
      product_name: i.product_name, description: i.description || '',
      quantity: i.quantity, unit: i.unit, unit_price: i.unit_price, discount_pct: i.discount_pct,
    })) : [emptyItem()]
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setItem = (i, k, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it));
  const addItem = () => setItems(prev => [...prev, emptyItem()]);
  const removeItem = i => setItems(prev => prev.filter((_, idx) => idx !== i));

  const subtotal = items.reduce((s, i) => s + lineTotal(i), 0);

  async function save() {
    const errs = {};
    if (!form.customer_id) errs.customer_id = t('offers.validation.customerRequired');
    if (!form.title.trim()) errs.title = t('offers.validation.titleRequired');
    if (items.length === 0 || !items.some(i => i.product_name.trim()))
      errs.items = t('offers.validation.itemRequired');
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSaving(true);
    try {
      const payload = { ...form, items };
      if (isEdit) {
        await api.patch(`/offers/${offer.id}`, payload);
      } else {
        await api.post('/offers', payload);
      }
      onSaved();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-40 overflow-y-auto py-8 px-4">
      <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-3xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-600">
          <h2 className="text-base font-semibold text-slate-100">
            {isEdit ? t('offers.editOffer') : t('offers.newOffer')}
            {offer?.offer_number && <span className="ml-2 text-sm text-slate-400">#{offer.offer_number}</span>}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Basic Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('offers.customer')} *</label>
              <select
                className={`input ${errors.customer_id ? 'border-red-500' : ''}`}
                value={form.customer_id}
                onChange={e => setF('customer_id', e.target.value)}
              >
                <option value="">{t('common.select')}…</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
              {errors.customer_id && <p className="text-xs text-red-400 mt-1">{errors.customer_id}</p>}
            </div>
            <div>
              <label className="form-label">{t('offers.titleField')} *</label>
              <input
                className={`input ${errors.title ? 'border-red-500' : ''}`}
                value={form.title}
                onChange={e => setF('title', e.target.value)}
                placeholder={t('offers.titleField')}
              />
              {errors.title && <p className="text-xs text-red-400 mt-1">{errors.title}</p>}
            </div>
            <div>
              <label className="form-label">{t('offers.currency')}</label>
              <select className="input" value={form.currency} onChange={e => setF('currency', e.target.value)}>
                {['USD','EUR','TRY','GBP','RUB'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">{t('offers.validityDays')}</label>
              <input
                className="input" type="number" min="1"
                value={form.validity_days}
                onChange={e => setF('validity_days', parseInt(e.target.value) || 30)}
              />
            </div>
          </div>
          <div>
            <label className="form-label">{t('offers.notes')}</label>
            <textarea
              className="input resize-none" rows={2}
              value={form.notes}
              onChange={e => setF('notes', e.target.value)}
            />
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-200">{t('offers.items')}</h3>
              <button onClick={addItem} className="btn-secondary text-xs py-1 px-3">{t('offers.addItem')}</button>
            </div>
            {errors.items && <p className="text-xs text-red-400 mb-2">{errors.items}</p>}

            {/* Table Header */}
            <div className="hidden sm:grid grid-cols-[2fr_1fr_80px_1fr_70px_80px_24px] gap-2 mb-1 px-1">
              {[t('offers.productName'), t('offers.description'), t('offers.qty'), t('offers.unitPrice'), t('offers.discount'), t('offers.lineTotal'), ''].map((h, i) => (
                <span key={i} className="text-xs text-slate-500">{h}</span>
              ))}
            </div>

            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-[2fr_1fr_80px_1fr_70px_80px_24px] gap-2 items-center">
                  <input
                    className="input text-sm py-1.5"
                    placeholder={t('offers.productName')}
                    value={item.product_name}
                    onChange={e => setItem(idx, 'product_name', e.target.value)}
                  />
                  <input
                    className="input text-sm py-1.5"
                    placeholder={t('offers.description')}
                    value={item.description}
                    onChange={e => setItem(idx, 'description', e.target.value)}
                  />
                  <input
                    className="input text-sm py-1.5 text-right"
                    type="number" min="0" step="0.01"
                    value={item.quantity}
                    onChange={e => setItem(idx, 'quantity', e.target.value)}
                  />
                  <input
                    className="input text-sm py-1.5 text-right"
                    type="number" min="0" step="0.01"
                    value={item.unit_price}
                    onChange={e => setItem(idx, 'unit_price', e.target.value)}
                  />
                  <input
                    className="input text-sm py-1.5 text-right"
                    type="number" min="0" max="100" step="0.1"
                    value={item.discount_pct}
                    onChange={e => setItem(idx, 'discount_pct', e.target.value)}
                  />
                  <span className="text-sm text-emerald-400 font-medium text-right">
                    {fmt(lineTotal(item))}
                  </span>
                  <button
                    onClick={() => removeItem(idx)}
                    className="text-slate-500 hover:text-red-400 text-sm transition-colors"
                    disabled={items.length === 1}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* Subtotal */}
            <div className="flex justify-end mt-3 pt-3 border-t border-dark-600">
              <span className="text-sm text-slate-400 mr-4">{t('offers.subtotal')}</span>
              <span className="text-base font-bold text-slate-100">
                {form.currency} {fmt(subtotal)}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-dark-600">
          <button onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function OffersPage() {
  const { t } = useTranslation();
  const user = useAuthStore(s => s.user);
  const [offers, setOffers]       = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editOffer, setEditOffer] = useState(null);
  const [toast, setToast]         = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const canEdit = ['owner','coordinator','sales'].includes(user?.role);
  const canDelete = ['owner','coordinator'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterStatus ? `?status=${filterStatus}` : '';
      const [oRes, cRes] = await Promise.all([
        api.get(`/offers${params}`),
        api.get('/customers?limit=500'),
      ]);
      setOffers(oRes.data.data);
      setCustomers(cRes.data.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  async function handleSend(id) {
    try {
      await api.post(`/offers/${id}/send`);
      setToast(t('offers.toast.sent'));
      load();
    } catch (e) { console.error(e); }
  }

  async function handleClone(id) {
    try {
      await api.post(`/offers/${id}/clone`);
      setToast(t('offers.toast.cloned'));
      load();
    } catch (e) { console.error(e); }
  }

  async function handleDelete(id) {
    if (!window.confirm(t('offers.deleteConfirm'))) return;
    try {
      await api.delete(`/offers/${id}`);
      setToast(t('offers.toast.deleted'));
      load();
    } catch (e) { console.error(e); }
  }

  async function openEdit(offer) {
    try {
      const res = await api.get(`/offers/${offer.id}`);
      setEditOffer(res.data.data);
      setShowModal(true);
    } catch (e) { console.error(e); }
  }

  function onSaved() {
    setShowModal(false);
    setEditOffer(null);
    setToast(t('offers.toast.saved'));
    load();
  }

  const statuses = ['draft','sent','accepted','rejected','expired'];

  return (
    <div className="p-6 space-y-5">
      {toast && <Toast msg={toast} onDone={() => setToast('')} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{t('nav.teklifMerkezi')}</h1>
          <p className="text-sm text-slate-400 mt-0.5">{offers.length} {t('offers.total')}</p>
        </div>
        {canEdit && (
          <button onClick={() => { setEditOffer(null); setShowModal(true); }} className="btn-primary">
            {t('offers.newOffer')}
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterStatus('')}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${filterStatus === '' ? 'bg-brand-600 text-white' : 'bg-dark-700 text-slate-400 hover:text-slate-200'}`}
        >
          {t('offers.allStatuses')}
        </button>
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${filterStatus === s ? 'bg-brand-600 text-white' : 'bg-dark-700 text-slate-400 hover:text-slate-200'}`}
          >
            {t(`offers.statuses.${s}`)}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-slate-400">{t('common.loading')}</p>
      ) : offers.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-slate-400">{t('offers.noOffers')}</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-600">
                {[t('offers.offerNumber'), t('offers.customer'), t('offers.titleField'), t('offers.totalAmount'), t('offers.status'), t('offers.validUntil'), t('common.actions')].map(h => (
                  <th key={h} className="text-left text-xs text-slate-400 font-medium px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {offers.map(offer => (
                <tr key={offer.id} className="border-b border-dark-700 hover:bg-dark-700/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-brand-400">{offer.offer_number}</td>
                  <td className="px-4 py-3 text-slate-200 max-w-[140px] truncate">{offer.company_name}</td>
                  <td className="px-4 py-3 text-slate-300 max-w-[200px] truncate">{offer.title}</td>
                  <td className="px-4 py-3 text-emerald-400 font-medium">
                    {offer.currency} {fmt(offer.total_amount)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={offer.status} t={t} />
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {offer.valid_until ? new Date(offer.valid_until).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {canEdit && (
                        <button onClick={() => openEdit(offer)} className="text-slate-400 hover:text-brand-400 transition-colors text-xs">
                          {t('common.edit')}
                        </button>
                      )}
                      {canEdit && offer.status === 'draft' && (
                        <button onClick={() => handleSend(offer.id)} className="text-slate-400 hover:text-blue-400 transition-colors text-xs">
                          {t('offers.send')}
                        </button>
                      )}
                      {canEdit && (
                        <button onClick={() => handleClone(offer.id)} className="text-slate-400 hover:text-amber-400 transition-colors text-xs">
                          {t('offers.clone')}
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => handleDelete(offer.id)} className="text-slate-400 hover:text-red-400 transition-colors text-xs">
                          {t('common.delete')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <OfferModal
          offer={editOffer}
          customers={customers}
          onClose={() => { setShowModal(false); setEditOffer(null); }}
          onSaved={onSaved}
          t={t}
        />
      )}
    </div>
  );
}
