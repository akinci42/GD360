import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../utils/api.js';

export default function QuickEditCustomerModal({ customer, salespeople, currentUser, onClose, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    company_name:    customer.company_name    || '',
    country:         customer.country         || '',
    city:            customer.city            || '',
    customer_type:   customer.customer_type   || 'direct',
    partner_subtype: customer.partner_subtype || '',
    status:          customer.status          || 'active',
    assigned_to:     customer.assigned_to     || '',
    notes:           customer.notes           || '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.company_name.trim()) { setError(t('crm.validation.companyRequired')); return; }
    if (form.customer_type === 'partner' && !form.partner_subtype) {
      setError(t('crm.validation.subtypeRequired'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = { ...form };
      if (form.customer_type !== 'partner') payload.partner_subtype = null;
      const { data: { data: updated } } = await api.patch(`/customers/${customer.id}`, payload);
      onSaved(updated);
    } catch (err) {
      setError(err.response?.data?.error || 'Hata');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-12 px-4">
      <div className="bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-[500px] max-w-full">
        <div className="flex items-center justify-between px-5 py-3 border-b border-dark-700">
          <h3 className="text-sm font-semibold text-slate-100">{t('crm.quickEdit')}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none transition-colors">×</button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('crm.companyName')} *</label>
            <input className="input w-full" value={form.company_name}
              onChange={e => setF('company_name', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('crm.country')}</label>
              <input className="input w-full" value={form.country}
                onChange={e => setF('country', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('crm.city')}</label>
              <input className="input w-full" value={form.city}
                onChange={e => setF('city', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('crm.customerType')}</label>
              <select className="input w-full" value={form.customer_type}
                onChange={e => { setF('customer_type', e.target.value); if (e.target.value !== 'partner') setF('partner_subtype', ''); }}>
                {['partner','direct','end_customer'].map(v => (
                  <option key={v} value={v}>{t(`crm.customerTypes.${v}`)}</option>
                ))}
              </select>
            </div>
            {form.customer_type === 'partner' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('crm.partnerSubtype')} *</label>
                <select className="input w-full" value={form.partner_subtype}
                  onChange={e => setF('partner_subtype', e.target.value)}>
                  <option value="">—</option>
                  {['distributor','regional_office'].map(v => (
                    <option key={v} value={v}>{t(`crm.partnerSubtypes.${v}`)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('crm.status')}</label>
              <select className="input w-full" value={form.status}
                onChange={e => setF('status', e.target.value)}>
                {['active','passive','blacklisted','unidentified'].map(v => (
                  <option key={v} value={v}>{t(`crm.statuses.${v}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('crm.assignedTo')}</label>
              <select className="input w-full" value={form.assigned_to}
                onChange={e => setF('assigned_to', e.target.value)}
                disabled={currentUser.role === 'sales'}>
                <option value="">—</option>
                {salespeople.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('crm.notes')}</label>
            <textarea className="input w-full resize-none" rows={2}
              value={form.notes} onChange={e => setF('notes', e.target.value)} />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving} className="btn-primary flex-1 text-sm">
              {saving ? t('common.loading') : t('common.save')}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1 text-sm">
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
