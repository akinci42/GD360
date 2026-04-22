import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import api from '../utils/api.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const CUSTOMER_TYPE_COLORS = {
  partner:      'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  direct:       'bg-slate-500/20 text-slate-300 border border-slate-500/30',
  end_customer: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
};

const STATUS_COLORS = {
  active:      'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  passive:     'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  blacklisted: 'bg-red-500/20 text-red-300 border border-red-500/30',
};

const STAGE_COLORS = {
  lead:        'bg-slate-500/20 text-slate-300',
  qualified:   'bg-sky-500/20 text-sky-300',
  proposal:    'bg-brand-500/20 text-brand-300',
  negotiation: 'bg-amber-500/20 text-amber-300',
  won:         'bg-emerald-500/20 text-emerald-300',
  lost:        'bg-red-500/20 text-red-400',
  on_hold:     'bg-slate-600/20 text-slate-400',
};

const FOLLOWUP_ICONS = { call: '📞', email: '✉️', meeting: '🤝', demo: '🖥️', site_visit: '🏭', other: '📌' };

function CustomerTypeBadge({ type, subtype, t }) {
  if (!type) return null;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CUSTOMER_TYPE_COLORS[type] || ''}`}>
        {t(`crm.customerTypes.${type}`)}
      </span>
      {subtype && (
        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-dark-600/60 text-slate-400 border border-dark-500/40">
          {t(`crm.partnerSubtypes.${subtype}`)}
        </span>
      )}
    </span>
  );
}

function StatusBadge({ status, t }) {
  if (!status) return null;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[status] || ''}`}>
      {t(`crm.statuses.${status}`)}
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

function Avatar({ name, size = 14 }) {
  const initials = (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const sizeClass = size === 14 ? 'w-14 h-14' : 'w-10 h-10';
  const textClass = size === 14 ? 'text-xl' : 'text-sm';
  return (
    <div className={`${sizeClass} rounded-xl bg-brand-700/60 flex items-center justify-center flex-shrink-0`}>
      <span className={`font-bold text-brand-200 ${textClass}`}>{initials}</span>
    </div>
  );
}

// ─── Contact Card ─────────────────────────────────────────────────────────────
function ContactCard({ contact, canEdit, onEdit, onDelete, onSetPrimary, t }) {
  return (
    <div className={`border rounded-xl p-4 transition-colors ${contact.is_primary ? 'border-brand-500/40 bg-brand-500/5' : 'border-dark-600 bg-dark-700/30'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-dark-600 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-slate-300">{(contact.full_name || '?').charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">{contact.full_name}</p>
            {contact.title && <p className="text-xs text-slate-500">{contact.title}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {contact.is_primary && (
            <span className="text-xs bg-brand-500/20 text-brand-400 border border-brand-500/30 px-2 py-0.5 rounded-full">
              ★ {t('crm.contacts.primary')}
            </span>
          )}
          {canEdit && (
            <div className="flex gap-1 ml-1">
              <button onClick={() => onEdit(contact)} className="text-slate-500 hover:text-brand-400 text-sm transition-colors" title={t('common.edit')}>✎</button>
              {!contact.is_primary && (
                <button onClick={() => onSetPrimary(contact)} className="text-slate-500 hover:text-amber-400 text-xs transition-colors" title={t('crm.contacts.setPrimary')}>★</button>
              )}
              <button onClick={() => onDelete(contact)} className="text-slate-500 hover:text-red-400 text-sm transition-colors" title={t('common.delete')}>✕</button>
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors" onClick={e => e.stopPropagation()}>
            <span className="text-slate-600">📞</span> {contact.phone}
          </a>
        )}
        {contact.whatsapp && (
          <a href={`https://wa.me/${contact.whatsapp.replace(/\D/g,'')}`} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 transition-colors" onClick={e => e.stopPropagation()}>
            <span>💬</span> {contact.whatsapp}
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 col-span-2 transition-colors" onClick={e => e.stopPropagation()}>
            <span className="text-slate-600">✉️</span> {contact.email}
          </a>
        )}
        {contact.language && (
          <span className="flex items-center gap-1.5 text-slate-500">
            <span>🌐</span> {contact.language}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Contact Modal ────────────────────────────────────────────────────────────
function ContactModal({ contact, customerId, onClose, onSaved, t }) {
  const [form, setForm] = useState({
    full_name: contact?.full_name || '',
    title: contact?.title || '',
    phone: contact?.phone || '',
    email: contact?.email || '',
    whatsapp: contact?.whatsapp || '',
    language: contact?.language || '',
    is_primary: contact?.is_primary || false,
    notes: contact?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.full_name.trim()) { setError(t('crm.validation.contactNameRequired')); return; }
    setSaving(true);
    try {
      if (contact) {
        await api.patch(`/customers/${customerId}/contacts/${contact.id}`, form);
      } else {
        await api.post(`/customers/${customerId}/contacts`, form);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Hata');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-700">
          <h3 className="text-sm font-semibold text-slate-100">
            {contact ? t('crm.contacts.edit') : t('crm.contacts.add')}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">{t('crm.contacts.name')} *</label>
              <input className="input w-full" value={form.full_name} onChange={e => setF('full_name', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('crm.contacts.jobTitle')}</label>
              <input className="input w-full" value={form.title} onChange={e => setF('title', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('crm.contacts.language')}</label>
              <input className="input w-full" value={form.language} onChange={e => setF('language', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('crm.contacts.phone')}</label>
              <input className="input w-full" value={form.phone} onChange={e => setF('phone', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('crm.contacts.whatsapp')}</label>
              <input className="input w-full" value={form.whatsapp} onChange={e => setF('whatsapp', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">{t('crm.contacts.email')}</label>
              <input className="input w-full" type="email" value={form.email} onChange={e => setF('email', e.target.value)} />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input type="checkbox" id="is_primary" checked={form.is_primary} onChange={e => setF('is_primary', e.target.checked)} className="accent-brand-500" />
              <label htmlFor="is_primary" className="text-xs text-slate-400 cursor-pointer">{t('crm.contacts.primary')}</label>
            </div>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? t('common.loading') : t('common.save')}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1">{t('common.cancel')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Company Info Form ────────────────────────────────────────────────────────
function CompanyInfoForm({ customer, salespeople, canEdit, onSaved, t }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...customer });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => { setForm({ ...customer }); }, [customer]);

  async function handleSave() {
    if (!form.company_name?.trim()) { setError(t('crm.validation.companyRequired')); return; }
    if (form.customer_type === 'partner' && !form.partner_subtype) {
      setError(t('crm.validation.subtypeRequired')); return;
    }
    setSaving(true);
    try {
      const payload = {
        company_name:    form.company_name,
        country:         form.country,
        city:            form.city,
        address:         form.address,
        industry:        form.industry,
        website:         form.website,
        phone:           form.phone,
        tax_number:      form.tax_number,
        customer_type:   form.customer_type,
        partner_subtype: form.customer_type === 'partner' ? form.partner_subtype : null,
        status:          form.status,
        notes:           form.notes,
        assigned_to:     form.assigned_to,
      };
      const r = await api.patch(`/customers/${customer.id}`, payload);
      onSaved(r.data.data);
      setEditing(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Hata');
    } finally { setSaving(false); }
  }

  const Field = ({ label, value, fieldKey, type = 'text', options }) => (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      {editing ? (
        options ? (
          <select className="input w-full text-sm" value={form[fieldKey] || ''} onChange={e => setF(fieldKey, e.target.value)}>
            <option value="">—</option>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : type === 'textarea' ? (
          <textarea className="input w-full text-sm resize-none" rows={3} value={form[fieldKey] || ''} onChange={e => setF(fieldKey, e.target.value)} />
        ) : (
          <input className="input w-full text-sm" type={type} value={form[fieldKey] || ''} onChange={e => setF(fieldKey, e.target.value)} />
        )
      ) : (
        <p className="text-sm text-slate-200 py-1 min-h-[1.75rem]">{value || <span className="text-slate-600 italic">—</span>}</p>
      )}
    </div>
  );

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-200">{t('crm.companyInfo')}</h3>
        {canEdit && (
          editing ? (
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving} className="btn-primary text-xs px-3 py-1.5">
                {saving ? '…' : t('common.save')}
              </button>
              <button onClick={() => { setEditing(false); setForm({ ...customer }); setError(''); }} className="btn-secondary text-xs px-3 py-1.5">
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button onClick={() => setEditing(true)} className="btn-secondary text-xs px-3 py-1.5">
              {t('common.edit')}
            </button>
          )
        )}
      </div>
      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
      <div className="space-y-3">
        <Field label={t('crm.companyName')} value={customer.company_name} fieldKey="company_name" />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('crm.country')} value={customer.country} fieldKey="country" />
          <Field label={t('crm.city')} value={customer.city} fieldKey="city" />
        </div>
        <Field label={t('crm.address')} value={customer.address} fieldKey="address" />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">{t('crm.customerType')}</label>
            {editing ? (
              <select className="input w-full text-sm" value={form.customer_type || ''} onChange={e => { setF('customer_type', e.target.value); setF('partner_subtype', ''); }}>
                <option value="">—</option>
                {['partner','direct','end_customer'].map(c => (
                  <option key={c} value={c}>{t(`crm.customerTypes.${c}`)}</option>
                ))}
              </select>
            ) : (
              <div className="py-1">
                {customer.customer_type
                  ? <CustomerTypeBadge type={customer.customer_type} subtype={customer.partner_subtype} t={t} />
                  : <span className="text-slate-600 italic text-sm">—</span>}
              </div>
            )}
          </div>
          {(editing ? form.customer_type === 'partner' : customer.customer_type === 'partner') && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">{t('crm.partnerSubtype')} *</label>
              {editing ? (
                <select className="input w-full text-sm" value={form.partner_subtype || ''} onChange={e => setF('partner_subtype', e.target.value)}>
                  <option value="">—</option>
                  {['distributor','regional_office'].map(s => (
                    <option key={s} value={s}>{t(`crm.partnerSubtypes.${s}`)}</option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-slate-200 py-1">
                  {customer.partner_subtype ? t(`crm.partnerSubtypes.${customer.partner_subtype}`) : <span className="text-slate-600 italic">—</span>}
                </p>
              )}
            </div>
          )}
          {(editing ? form.customer_type !== 'partner' : customer.customer_type !== 'partner') && (
            <Field label={t('crm.industry')} value={customer.industry} fieldKey="industry" />
          )}
        </div>
        {customer.customer_type === 'partner' && !editing && (
          <Field label={t('crm.industry')} value={customer.industry} fieldKey="industry" />
        )}
        {editing && form.customer_type === 'partner' && (
          <Field label={t('crm.industry')} value={customer.industry} fieldKey="industry" />
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">{t('crm.status')}</label>
            {editing ? (
              <select className="input w-full text-sm" value={form.status || ''} onChange={e => setF('status', e.target.value)}>
                <option value="">—</option>
                {['active','passive','blacklisted'].map(s => (
                  <option key={s} value={s}>{t(`crm.statuses.${s}`)}</option>
                ))}
              </select>
            ) : (
              <div className="py-1">
                {customer.status
                  ? <StatusBadge status={customer.status} t={t} />
                  : <span className="text-slate-600 italic text-sm">—</span>}
              </div>
            )}
          </div>
          <Field label={t('crm.taxNumber')} value={customer.tax_number} fieldKey="tax_number" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('crm.phone')} value={customer.phone} fieldKey="phone" />
          <Field label={t('crm.website')} value={customer.website} fieldKey="website" type="url" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">{t('crm.assignedTo')}</label>
          {editing ? (
            <select className="input w-full text-sm" value={form.assigned_to || ''} onChange={e => setF('assigned_to', e.target.value)}>
              <option value="">—</option>
              {salespeople.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          ) : (
            <p className="text-sm text-slate-200 py-1">{customer.assigned_to_name || <span className="text-slate-600 italic">—</span>}</p>
          )}
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">{t('crm.notes')}</label>
          {editing ? (
            <textarea className="input w-full text-sm resize-none" rows={3} value={form.notes || ''} onChange={e => setF('notes', e.target.value)} />
          ) : (
            <p className="text-sm text-slate-300 py-1 leading-relaxed whitespace-pre-wrap">
              {customer.notes || <span className="text-slate-600 italic">—</span>}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Detail Page ─────────────────────────────────────────────────────────
export default function CrmDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const currentUser = useAuthStore(s => s.user);

  const [customer,     setCustomer]     = useState(null);
  const [contacts,     setContacts]     = useState([]);
  const [opportunities,setOpportunities]= useState([]);
  const [followups,    setFollowups]    = useState([]);
  const [salespeople,  setSalespeople]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [contactModal, setContactModal] = useState(null); // null | 'new' | contact object
  const [toast,        setToast]        = useState('');

  const canEdit = ['owner','coordinator','sales'].includes(currentUser?.role);
  const canDelete = ['owner','coordinator'].includes(currentUser?.role);

  const showToast = (msg) => { setToast(msg); };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cust, conts, opps, fups, opts] = await Promise.all([
        api.get(`/customers/${id}`),
        api.get(`/customers/${id}/contacts`),
        api.get(`/opportunities?customer_id=${id}&limit=20`),
        api.get(`/followups?customer_id=${id}&limit=10`),
        api.get('/customers/filter-options'),
      ]);
      setCustomer(cust.data.data);
      setContacts(conts.data.data);
      setOpportunities(opps.data.data);
      setFollowups(fups.data.data);
      setSalespeople(opts.data.data.salespeople);
    } catch {
      navigate('/crm');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function handleDeleteCustomer() {
    if (!window.confirm(t('crm.deleteConfirm'))) return;
    try {
      await api.delete(`/customers/${id}`);
      showToast(t('crm.toast.deleted'));
      setTimeout(() => navigate('/crm'), 500);
    } catch { /* noop */ }
  }

  async function handleDeleteContact(contact) {
    if (!window.confirm(t('crm.contacts.deleteConfirm'))) return;
    try {
      await api.delete(`/customers/${id}/contacts/${contact.id}`);
      setContacts(cs => cs.filter(c => c.id !== contact.id));
      showToast(t('crm.toast.contactDeleted'));
    } catch { /* noop */ }
  }

  async function handleSetPrimary(contact) {
    try {
      await api.patch(`/customers/${id}/contacts/${contact.id}`, { is_primary: true });
      const r = await api.get(`/customers/${id}/contacts`);
      setContacts(r.data.data);
      showToast(t('crm.toast.contactUpdated'));
    } catch { /* noop */ }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-400">{t('common.loading')}</p>
      </div>
    );
  }

  if (!customer) return null;

  const sinceYear = new Date(customer.created_at).getFullYear();
  const primaryContact = contacts.find(c => c.is_primary) || contacts[0];

  // KPIs
  const totalProjects  = opportunities.length;
  const wonRevenue     = opportunities.filter(o => o.stage === 'won').reduce((s, o) => s + parseFloat(o.value || 0), 0);
  const activeOffers   = opportunities.filter(o => !['won','lost'].includes(o.stage)).length;
  const lastFollowup   = followups[0]?.scheduled_at;

  function fmtDate(d, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
    if (!d) return null;
    return new Date(d).toLocaleDateString('tr-TR', opts);
  }

  function fmtCurrency(val) {
    if (!val) return '—';
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* ── Header ── */}
      <div>
        <button onClick={() => navigate('/crm')} className="text-xs text-slate-500 hover:text-brand-400 transition-colors mb-4 flex items-center gap-1">
          ← {t('nav.crm')}
        </button>

        <div className="card">
          <div className="flex flex-wrap items-start gap-4 mb-4">
            <Avatar name={customer.company_name} size={14} />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h1 className="text-xl font-bold text-slate-100">{customer.company_name}</h1>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {customer.country && (
                      <span className="text-sm text-slate-400">
                        {[customer.city, customer.country].filter(Boolean).join(', ')}
                      </span>
                    )}
                    {customer.customer_type && (
                      <CustomerTypeBadge type={customer.customer_type} subtype={customer.partner_subtype} t={t} />
                    )}
                    {customer.status && (
                      <StatusBadge status={customer.status} t={t} />
                    )}
                    <span className="text-xs text-slate-500">
                      {t('crm.sinceYear', { year: sinceYear })}
                    </span>
                  </div>
                </div>
                {canDelete && (
                  <button onClick={handleDeleteCustomer}
                    className="text-xs text-slate-600 hover:text-red-400 transition-colors border border-dark-600 hover:border-red-500/30 px-2.5 py-1 rounded-lg">
                    {t('crm.deleteCustomer')}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: t('crm.kpi.totalProjects'),  value: totalProjects,        icon: '📁' },
              { label: t('crm.kpi.revenue'),         value: fmtCurrency(wonRevenue), icon: '💵' },
              { label: t('crm.kpi.activeOffers'),    value: activeOffers,         icon: '📄' },
              { label: t('crm.kpi.lastContact'),     value: lastFollowup ? fmtDate(lastFollowup) : t('crm.kpi.lastContact'), icon: '📅' },
            ].map((kpi, i) => (
              <div key={i} className="bg-dark-700/40 border border-dark-600 rounded-xl p-3">
                <p className="text-xs text-slate-500 mb-1">{kpi.label}</p>
                <p className="text-lg font-bold text-slate-100">{kpi.value}</p>
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-2">
            {primaryContact?.whatsapp && (
              <a href={`https://wa.me/${primaryContact.whatsapp.replace(/\D/g,'')}`} target="_blank" rel="noreferrer"
                className="btn-secondary text-xs flex items-center gap-1.5 no-underline">
                💬 {t('crm.actions.whatsapp')}
              </a>
            )}
            {primaryContact?.phone && (
              <a href={`tel:${primaryContact.phone}`}
                className="btn-secondary text-xs flex items-center gap-1.5 no-underline">
                📞 {t('crm.actions.call')}
              </a>
            )}
            {primaryContact?.email && (
              <a href={`mailto:${primaryContact.email}`}
                className="btn-secondary text-xs flex items-center gap-1.5 no-underline">
                ✉️ {t('crm.actions.email')}
              </a>
            )}
            <button className="btn-primary text-xs flex items-center gap-1.5">
              📄 {t('crm.actions.newOffer')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Company Info + Contacts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <CompanyInfoForm
          customer={customer}
          salespeople={salespeople}
          canEdit={canEdit}
          onSaved={updated => { setCustomer(updated); showToast(t('crm.toast.saved')); }}
          t={t}
        />

        {/* Contacts panel */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-200">
              {t('crm.contacts.title')} <span className="text-slate-500 font-normal ml-1">({contacts.length})</span>
            </h3>
            {canEdit && (
              <button onClick={() => setContactModal('new')} className="btn-primary text-xs px-3 py-1.5">
                {t('crm.contacts.add')}
              </button>
            )}
          </div>
          {contacts.length === 0 ? (
            <p className="text-sm text-slate-500 italic text-center py-6">{t('common.noData')}</p>
          ) : (
            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {contacts.map(c => (
                <ContactCard
                  key={c.id}
                  contact={c}
                  canEdit={canEdit}
                  onEdit={setContactModal}
                  onDelete={handleDeleteContact}
                  onSetPrimary={handleSetPrimary}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Projects + Activities ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Opportunities */}
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">
            {t('crm.projects.title')} <span className="text-slate-500 font-normal ml-1">({opportunities.length})</span>
          </h3>
          {opportunities.length === 0 ? (
            <p className="text-sm text-slate-500 italic text-center py-6">{t('crm.projects.none')}</p>
          ) : (
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {opportunities.map(o => (
                <div key={o.id} className="flex items-center justify-between border border-dark-600 rounded-lg px-3 py-2.5 hover:bg-dark-700/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 font-medium truncate">{o.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{o.assigned_to_name || '—'}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                    {o.value && <span className="text-xs text-slate-400 font-mono">{fmtCurrency(o.value)}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLORS[o.stage] || ''}`}>
                      {t(`pipeline.${o.stage === 'on_hold' ? 'onHold' : o.stage}`)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Follow-ups timeline */}
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">
            {t('crm.activities.title')} <span className="text-slate-500 font-normal ml-1">({followups.length})</span>
          </h3>
          {followups.length === 0 ? (
            <p className="text-sm text-slate-500 italic text-center py-6">{t('crm.activities.none')}</p>
          ) : (
            <div className="relative max-h-[340px] overflow-y-auto pr-1">
              <div className="absolute left-4 top-0 bottom-0 w-px bg-dark-600" />
              <div className="space-y-3 pl-10">
                {followups.map(f => (
                  <div key={f.id} className="relative">
                    <div className="absolute -left-[1.625rem] top-1 w-4 h-4 rounded-full bg-dark-700 border-2 border-dark-500 flex items-center justify-center text-xs">
                      {FOLLOWUP_ICONS[f.type] || '📌'}
                    </div>
                    <div className={`border rounded-lg px-3 py-2.5 ${f.completed_at ? 'border-dark-600 opacity-60' : 'border-brand-500/30 bg-brand-500/5'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-slate-200 font-medium">{f.subject}</p>
                        {f.completed_at && <span className="text-xs text-emerald-500 flex-shrink-0">✓</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-500">{fmtDate(f.scheduled_at)}</span>
                        {f.assigned_to_name && <span className="text-xs text-slate-500">{f.assigned_to_name}</span>}
                      </div>
                      {f.notes && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{f.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Contact modal */}
      {contactModal && (
        <ContactModal
          contact={contactModal === 'new' ? null : contactModal}
          customerId={id}
          onClose={() => setContactModal(null)}
          onSaved={async () => {
            setContactModal(null);
            const r = await api.get(`/customers/${id}/contacts`);
            setContacts(r.data.data);
            showToast(contactModal === 'new' ? t('crm.toast.contactAdded') : t('crm.toast.contactUpdated'));
          }}
          t={t}
        />
      )}

      {toast && <Toast msg={toast} onDone={() => setToast('')} />}
    </div>
  );
}
