import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import api from '../utils/api.js';

// ─── Badge helpers ────────────────────────────────────────────────────────────
const CUSTOMER_TYPE_COLORS = {
  partner:      'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  direct:       'bg-slate-500/20 text-slate-300 border border-slate-500/30',
  end_customer: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
};

const SUBTYPE_COLORS = {
  distributor:     'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
  regional_office: 'bg-teal-500/20 text-teal-300 border border-teal-500/30',
};

const STATUS_COLORS = {
  active:      'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  passive:     'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  blacklisted: 'bg-red-500/20 text-red-300 border border-red-500/30',
};

function CustomerTypeBadge({ type, subtype, t }) {
  if (!type) return <span className="text-slate-600 text-xs">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium w-fit ${CUSTOMER_TYPE_COLORS[type] || 'bg-slate-700 text-slate-400'}`}>
        {t(`crm.customerTypes.${type}`, type)}
      </span>
      {subtype && (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium w-fit ${SUBTYPE_COLORS[subtype] || 'bg-slate-700 text-slate-400'}`}>
          {t(`crm.partnerSubtypes.${subtype}`, subtype)}
        </span>
      )}
    </div>
  );
}

function StatusBadge({ status, t }) {
  if (!status) return null;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[status] || 'bg-slate-700 text-slate-400'}`}>
      {t(`crm.statuses.${status}`, status)}
    </span>
  );
}

function Avatar({ name }) {
  const initials = (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="w-9 h-9 rounded-lg bg-brand-700/50 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-brand-200">{initials}</span>
    </div>
  );
}

function Toast({ msg, onDone }) {
  useEffect(() => { const id = setTimeout(onDone, 3000); return () => clearTimeout(id); }, [onDone]);
  return (
    <div className="fixed bottom-6 right-6 bg-emerald-600 text-white text-sm px-4 py-2.5 rounded-lg shadow-xl z-50 animate-pulse-once">
      ✓ {msg}
    </div>
  );
}

// ─── New Customer Modal ───────────────────────────────────────────────────────
function NewCustomerModal({ onClose, onCreated, salespeople, currentUser }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    company_name: '', country: '', city: '', address: '',
    industry: '', website: '', phone: '', tax_number: '',
    customer_type: 'direct', partner_subtype: '', notes: '',
    assigned_to: currentUser.role === 'sales' ? currentUser.id : '',
  });
  const [contacts, setContacts] = useState([
    { full_name: '', title: '', phone: '', email: '', whatsapp: '', language: '', is_primary: true },
  ]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function addContact() {
    setContacts(cs => [...cs, { full_name: '', title: '', phone: '', email: '', whatsapp: '', language: '', is_primary: false }]);
  }

  function setContact(i, k, v) {
    setContacts(cs => cs.map((c, idx) => idx === i ? { ...c, [k]: v } : c));
  }

  function setPrimary(i) {
    setContacts(cs => cs.map((c, idx) => ({ ...c, is_primary: idx === i })));
  }

  function removeContact(i) {
    setContacts(cs => {
      const next = cs.filter((_, idx) => idx !== i);
      if (next.length && !next.some(c => c.is_primary)) next[0].is_primary = true;
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = {};
    if (!form.company_name.trim()) errs.company_name = t('crm.validation.companyRequired');
    if (!form.country.trim())      errs.country      = t('crm.validation.countryRequired');
    if (!form.customer_type)       errs.customer_type = t('crm.validation.channelRequired');
    if (form.customer_type === 'partner' && !form.partner_subtype) {
      errs.partner_subtype = t('crm.validation.subtypeRequired');
    }
    if (!form.assigned_to)         errs.assigned_to  = t('crm.validation.assignedRequired');
    const cErrs = contacts.map(c => c.full_name.trim() ? '' : t('crm.validation.contactNameRequired'));
    if (cErrs.some(Boolean)) errs.contacts = cErrs;
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSaving(true);
    try {
      const payload = { ...form };
      if (form.customer_type !== 'partner') payload.partner_subtype = null;
      const { data: { data: customer } } = await api.post('/customers', payload);
      for (const c of contacts) {
        if (c.full_name.trim()) await api.post(`/customers/${customer.id}/contacts`, c);
      }
      onCreated(customer);
    } catch (err) {
      setErrors({ general: err.response?.data?.error || 'Hata oluştu' });
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-8 px-4">
      <div className="bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-full max-w-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700">
          <h3 className="text-base font-semibold text-slate-100">{t('crm.newCustomer')}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none transition-colors">×</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          {/* Company */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{t('crm.companyInfo')}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">{t('crm.companyName')} *</label>
                <input className={`input w-full ${errors.company_name ? 'border-red-500/70' : ''}`}
                  value={form.company_name} onChange={e => setF('company_name', e.target.value)} />
                {errors.company_name && <p className="text-xs text-red-400 mt-1">{errors.company_name}</p>}
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('crm.country')} *</label>
                <input className={`input w-full ${errors.country ? 'border-red-500/70' : ''}`}
                  value={form.country} onChange={e => setF('country', e.target.value)} />
                {errors.country && <p className="text-xs text-red-400 mt-1">{errors.country}</p>}
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('crm.city')}</label>
                <input className="input w-full" value={form.city} onChange={e => setF('city', e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">{t('crm.address')}</label>
                <input className="input w-full" value={form.address} onChange={e => setF('address', e.target.value)} />
              </div>
              {/* customer_type */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('crm.customerType')} *</label>
                <select className={`input w-full ${errors.customer_type ? 'border-red-500/70' : ''}`}
                  value={form.customer_type}
                  onChange={e => { setF('customer_type', e.target.value); if (e.target.value !== 'partner') setF('partner_subtype', ''); }}>
                  {['partner', 'direct', 'end_customer'].map(v => (
                    <option key={v} value={v}>{t(`crm.customerTypes.${v}`)}</option>
                  ))}
                </select>
                {errors.customer_type && <p className="text-xs text-red-400 mt-1">{errors.customer_type}</p>}
              </div>
              {/* partner_subtype — only when partner */}
              {form.customer_type === 'partner' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">{t('crm.partnerSubtype')} *</label>
                  <select className={`input w-full ${errors.partner_subtype ? 'border-red-500/70' : ''}`}
                    value={form.partner_subtype} onChange={e => setF('partner_subtype', e.target.value)}>
                    <option value="">—</option>
                    {['distributor', 'regional_office'].map(v => (
                      <option key={v} value={v}>{t(`crm.partnerSubtypes.${v}`)}</option>
                    ))}
                  </select>
                  {errors.partner_subtype && <p className="text-xs text-red-400 mt-1">{errors.partner_subtype}</p>}
                </div>
              )}
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('crm.assignedTo')} *</label>
                <select className={`input w-full ${errors.assigned_to ? 'border-red-500/70' : ''}`}
                  value={form.assigned_to} onChange={e => setF('assigned_to', e.target.value)}
                  disabled={currentUser.role === 'sales'}>
                  <option value="">—</option>
                  {salespeople.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
                {errors.assigned_to && <p className="text-xs text-red-400 mt-1">{errors.assigned_to}</p>}
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('crm.industry')}</label>
                <input className="input w-full" value={form.industry} onChange={e => setF('industry', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('crm.phone')}</label>
                <input className="input w-full" value={form.phone} onChange={e => setF('phone', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('crm.taxNumber')}</label>
                <input className="input w-full" value={form.tax_number} onChange={e => setF('tax_number', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('crm.website')}</label>
                <input className="input w-full" value={form.website} onChange={e => setF('website', e.target.value)} placeholder="https://" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">{t('crm.notes')}</label>
                <textarea className="input w-full resize-none" rows={2} value={form.notes} onChange={e => setF('notes', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Contacts */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('crm.contacts.title')}</p>
              <button type="button" onClick={addContact}
                className="text-xs text-brand-400 hover:text-brand-300 transition-colors font-medium">
                {t('crm.contacts.add')}
              </button>
            </div>
            <div className="space-y-3">
              {contacts.map((c, i) => (
                <div key={i} className="bg-dark-700/40 border border-dark-600 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-500">Kişi {i + 1}</span>
                    <div className="flex items-center gap-3">
                      {c.is_primary
                        ? <span className="text-xs text-amber-400 font-medium">★ {t('crm.contacts.primary')}</span>
                        : <button type="button" onClick={() => setPrimary(i)} className="text-xs text-slate-500 hover:text-amber-400 transition-colors">
                            ☆ {t('crm.contacts.setPrimary')}
                          </button>
                      }
                      {contacts.length > 1 && (
                        <button type="button" onClick={() => removeContact(i)}
                          className="text-xs text-slate-600 hover:text-red-400 transition-colors">✕</button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <input className={`input w-full text-sm ${errors.contacts?.[i] ? 'border-red-500/70' : ''}`}
                        placeholder={`${t('crm.contacts.name')} *`}
                        value={c.full_name} onChange={e => setContact(i, 'full_name', e.target.value)} />
                      {errors.contacts?.[i] && <p className="text-xs text-red-400 mt-0.5">{errors.contacts[i]}</p>}
                    </div>
                    <input className="input text-sm" placeholder={t('crm.contacts.jobTitle')} value={c.title} onChange={e => setContact(i, 'title', e.target.value)} />
                    <input className="input text-sm" placeholder={t('crm.contacts.language')} value={c.language} onChange={e => setContact(i, 'language', e.target.value)} />
                    <input className="input text-sm" placeholder={t('crm.contacts.phone')} value={c.phone} onChange={e => setContact(i, 'phone', e.target.value)} />
                    <input className="input text-sm" placeholder={t('crm.contacts.whatsapp')} value={c.whatsapp} onChange={e => setContact(i, 'whatsapp', e.target.value)} />
                    <input className="input text-sm col-span-2" type="email" placeholder={t('crm.contacts.email')} value={c.email} onChange={e => setContact(i, 'email', e.target.value)} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {errors.general && <p className="text-sm text-red-400">{errors.general}</p>}
          <div className="flex gap-3">
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

// ─── Main list page ───────────────────────────────────────────────────────────
export default function CrmPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentUser = useAuthStore(s => s.user);

  const [searchParams, setSearchParams] = useSearchParams();
  const [customers,      setCustomers]      = useState([]);
  const [total,          setTotal]          = useState(0);
  const [page,           setPage]           = useState(1);
  const [loading,        setLoading]        = useState(false);
  const [showModal,      setShowModal]      = useState(false);
  const [toast,          setToast]          = useState('');
  const [filterOptions,  setFilterOptions]  = useState({ countries: [], salespeople: [] });
  // searchInput is the controlled input value; URL param drives the API
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const searchTimer = useRef(null);
  const LIMIT = 50;

  // Read all filter values from URL
  const search         = searchParams.get('search')         || '';
  const filterCountry  = searchParams.get('country')        || '';
  const filterType     = searchParams.get('customer_type')  || '';
  const filterSubtype  = searchParams.get('partner_subtype')|| '';
  const filterStatus   = searchParams.get('status')         || '';
  const filterAssigned = searchParams.get('assigned_to')    || '';

  function setParam(key, value) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      // reset partner_subtype if customer_type changes away from partner
      if (key === 'customer_type' && value !== 'partner') next.delete('partner_subtype');
      return next;
    }, { replace: true });
  }

  function clearFilters() {
    setSearchInput('');
    setSearchParams({}, { replace: true });
  }

  useEffect(() => {
    api.get('/customers/filter-options').then(r => setFilterOptions(r.data.data)).catch(() => {});
  }, []);

  // Debounce searchInput → URL
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setParam('search', searchInput), 350);
    return () => clearTimeout(searchTimer.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const load = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const params = { page: pg, limit: LIMIT };
      if (search)         params.search          = search;
      if (filterCountry)  params.country         = filterCountry;
      if (filterType)     params.customer_type   = filterType;
      if (filterSubtype)  params.partner_subtype = filterSubtype;
      if (filterStatus)   params.status          = filterStatus;
      if (filterAssigned) params.assigned_to     = filterAssigned;
      const r = await api.get('/customers', { params });
      setCustomers(r.data.data);
      setTotal(r.data.total);
      setPage(pg);
    } catch { /* interceptor */ }
    finally { setLoading(false); }
  }, [search, filterCountry, filterType, filterSubtype, filterStatus, filterAssigned]);

  useEffect(() => { load(1); }, [load]);

  function fmtDate(d) {
    if (!d) return null;
    return new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  const totalPages = Math.ceil(total / LIMIT);
  const hasFilters = searchInput || filterCountry || filterType || filterSubtype || filterStatus || filterAssigned;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{t('crm.title')}</h1>
          <p className="text-slate-400 text-sm mt-0.5">{total} {t('nav.crm').toLowerCase()}</p>
        </div>
        {['owner','coordinator','sales'].includes(currentUser?.role) && (
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            {t('crm.newCustomer')}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card mb-4 space-y-2">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <input
            className="input flex-1 min-w-52"
            placeholder={t('crm.searchPlaceholder')}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
          {/* Country */}
          <select className="input w-40" value={filterCountry}
            onChange={e => setParam('country', e.target.value)}>
            <option value="">{t('crm.allCountries')}</option>
            {filterOptions.countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {/* Customer type */}
          <select className="input w-40" value={filterType}
            onChange={e => setParam('customer_type', e.target.value)}>
            <option value="">{t('crm.allTypes')}</option>
            {['partner','direct','end_customer'].map(v => (
              <option key={v} value={v}>{t(`crm.customerTypes.${v}`)}</option>
            ))}
          </select>
          {/* Subtype — only when type=partner */}
          {filterType === 'partner' && (
            <select className="input w-44" value={filterSubtype}
              onChange={e => setParam('partner_subtype', e.target.value)}>
              <option value="">{t('crm.allSubtypes')}</option>
              {['distributor','regional_office'].map(v => (
                <option key={v} value={v}>{t(`crm.partnerSubtypes.${v}`)}</option>
              ))}
            </select>
          )}
          {/* Status */}
          <select className="input w-40" value={filterStatus}
            onChange={e => setParam('status', e.target.value)}>
            <option value="">{t('crm.allStatuses')}</option>
            {['active','passive','blacklisted'].map(v => (
              <option key={v} value={v}>{t(`crm.statuses.${v}`)}</option>
            ))}
          </select>
          {/* Assigned — owner/coordinator only */}
          {['owner','coordinator'].includes(currentUser?.role) && (
            <select className="input w-48" value={filterAssigned}
              onChange={e => setParam('assigned_to', e.target.value)}>
              <option value="">{t('crm.allSalespeople')}</option>
              {filterOptions.salespeople.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          )}
          {hasFilters && (
            <button onClick={clearFilters}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors">
              ✕ Temizle
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[960px]">
          <thead>
            <tr className="border-b border-dark-700">
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Firma</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">{t('crm.location')}</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">{t('crm.customerType')}</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">{t('crm.status')}</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Yetkili Kişi</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">{t('crm.assignedTo')}</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">{t('crm.lastActivity')}</th>
              <th className="w-8 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="text-center py-14 text-slate-500">{t('common.loading')}</td></tr>
            )}
            {!loading && customers.length === 0 && (
              <tr><td colSpan={8} className="text-center py-14 text-slate-500">{t('common.noData')}</td></tr>
            )}
            {customers.map(c => (
              <tr
                key={c.id}
                className="border-b border-dark-700/40 hover:bg-dark-700/30 cursor-pointer transition-colors group"
                onClick={() => navigate(`/crm/${c.id}`)}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={c.company_name} />
                    <div>
                      <p className="text-slate-100 font-medium group-hover:text-brand-300 transition-colors">{c.company_name}</p>
                      {c.industry && <p className="text-xs text-slate-500 mt-0.5">{c.industry}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400 text-sm">
                  {[c.city, c.country].filter(Boolean).join(', ') || '—'}
                </td>
                <td className="px-4 py-3">
                  <CustomerTypeBadge type={c.customer_type} subtype={c.partner_subtype} t={t} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={c.status} t={t} />
                </td>
                <td className="px-4 py-3">
                  {c.primary_contact_name ? (
                    <div>
                      <p className="text-slate-200 text-sm">{c.primary_contact_name}</p>
                      {c.primary_contact_phone && (
                        <p className="text-xs text-slate-500 font-mono mt-0.5">{c.primary_contact_phone}</p>
                      )}
                    </div>
                  ) : (
                    <span className="text-slate-600 text-xs italic">
                      {parseInt(c.contacts_count) > 0 ? `${c.contacts_count} kişi` : '—'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-400 text-sm">{c.assigned_to_name || '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {c.last_activity_at
                    ? fmtDate(c.last_activity_at)
                    : <span className="italic text-slate-600">{t('crm.noActivity')}</span>}
                </td>
                <td className="px-2 py-3 text-slate-600 group-hover:text-brand-400 transition-colors text-base">›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-slate-500">
            Gösterilen: {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} / {total}
          </p>
          <div className="flex items-center gap-1">
            <button className="btn-secondary text-xs px-3 py-1.5" disabled={page === 1} onClick={() => load(page - 1)}>‹</button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const pg = page <= 4 ? i + 1 : page - 3 + i;
              if (pg < 1 || pg > totalPages) return null;
              return (
                <button key={pg} onClick={() => load(pg)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${pg === page ? 'bg-brand-600 text-white' : 'btn-secondary'}`}>
                  {pg}
                </button>
              );
            })}
            <button className="btn-secondary text-xs px-3 py-1.5" disabled={page === totalPages} onClick={() => load(page + 1)}>›</button>
          </div>
        </div>
      )}

      {showModal && (
        <NewCustomerModal
          onClose={() => setShowModal(false)}
          onCreated={customer => { setShowModal(false); setToast(t('crm.toast.saved')); navigate(`/crm/${customer.id}`); }}
          salespeople={filterOptions.salespeople}
          currentUser={currentUser}
        />
      )}

      {toast && <Toast msg={toast} onDone={() => setToast('')} />}
    </div>
  );
}
