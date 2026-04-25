import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore.js';
import api from '../utils/api.js';

// ─── Stats row ────────────────────────────────────────────────────────────────
function StatsRow({ stats, t }) {
  const Card = ({ label, value, color }) => (
    <div className={`card flex-1 ${color}`}>
      <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-100">{value ?? '—'}</p>
    </div>
  );
  return (
    <div className="flex gap-3 mb-4">
      <Card label={t('endCustomerReview.pending')}        value={stats?.pending ?? 0}                   color="border-l-4 border-amber-500/60" />
      <Card label={t('endCustomerReview.reviewedLinked')} value={stats?.reviewed_linked_or_created ?? 0} color="border-l-4 border-emerald-500/60" />
      <Card label={t('endCustomerReview.reviewedRejected')} value={stats?.reviewed_rejected ?? 0}        color="border-l-4 border-slate-600" />
      <Card label={t('endCustomerReview.uniqueCreated')}  value={stats?.unique_end_customers_created ?? 0} color="border-l-4 border-brand-500/60" />
    </div>
  );
}

// ─── Approve modal ────────────────────────────────────────────────────────────
function ApproveModal({ item, onCancel, onConfirm, busy, t }) {
  const [companyName, setCompanyName] = useState(item.suggestion || '');
  const [country,     setCountry]     = useState(item.partner?.country || item.ulke || '');
  const [city,        setCity]        = useState(item.lokasyon || '');
  const [notes,       setNotes]       = useState('');

  function submit() {
    if (!companyName.trim()) return;
    onConfirm({ company_name: companyName.trim(), country: country.trim() || null, city: city.trim() || null, notes: notes.trim() || null });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-[520px] max-w-full p-5">
        <h3 className="text-sm font-semibold text-slate-100 mb-3">{t('endCustomerReview.approveTitle')}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">{t('endCustomerReview.companyName')}</label>
            <input
              autoFocus
              className="input w-full"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-slate-400 block mb-1">{t('endCustomerReview.country')}</label>
              <input className="input w-full" value={country} onChange={e => setCountry(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-slate-400 block mb-1">{t('endCustomerReview.city')}</label>
              <input className="input w-full" value={city} onChange={e => setCity(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{t('endCustomerReview.notes')}</label>
            <input className="input w-full" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-3 italic">
          {t('endCustomerReview.approveHint', { partner: item.partner?.company_name })}
        </p>
        <div className="flex gap-3 mt-4">
          <button onClick={submit} disabled={busy || !companyName.trim()}
            className="btn-primary bg-emerald-600 hover:bg-emerald-500 flex-1 text-sm disabled:opacity-50">
            {busy ? t('common.loading') : t('endCustomerReview.createNew')}
          </button>
          <button onClick={onCancel} className="btn-secondary flex-1 text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Reject modal ─────────────────────────────────────────────────────────────
function RejectModal({ onCancel, onConfirm, busy, t }) {
  const [notes, setNotes] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-[420px] max-w-full p-5">
        <h3 className="text-sm font-semibold text-slate-100 mb-3">{t('endCustomerReview.rejectTitle')}</h3>
        <label className="text-xs text-slate-400 block mb-1">{t('endCustomerReview.rejectReason')}</label>
        <input
          autoFocus
          className="input w-full"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(notes.trim() || null); }}
          placeholder={t('endCustomerReview.rejectPlaceholder')}
        />
        <div className="flex gap-3 mt-4">
          <button onClick={() => onConfirm(notes.trim() || null)} disabled={busy}
            className="btn-primary bg-slate-600 hover:bg-slate-500 flex-1 text-sm">
            {busy ? t('common.loading') : t('endCustomerReview.reject')}
          </button>
          <button onClick={onCancel} className="btn-secondary flex-1 text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Link-to-existing modal ───────────────────────────────────────────────────
function LinkModal({ item, onCancel, onConfirm, busy, t }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [picked, setPicked]   = useState(null);
  const [notes, setNotes]     = useState('');
  const [searching, setSearching] = useState(false);

  // Initial fetch + debounced search
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.get('/end-customer/search-existing', {
          params: { partner_id: item.partner?.id, q, limit: 20 },
        });
        if (!cancelled) setResults(r.data.data || []);
      } catch { /* ignore */ }
      finally { if (!cancelled) setSearching(false); }
    }, q ? 200 : 0);
    return () => { cancelled = true; clearTimeout(id); };
  }, [q, item.partner?.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-[520px] max-w-full p-5">
        <h3 className="text-sm font-semibold text-slate-100 mb-3">{t('endCustomerReview.linkTitle')}</h3>
        <p className="text-xs text-slate-500 mb-3">
          {t('endCustomerReview.linkHint', { partner: item.partner?.company_name })}
        </p>
        <input
          autoFocus
          className="input w-full mb-2"
          placeholder={t('endCustomerReview.linkSearchPlaceholder')}
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <div className="bg-dark-900/60 border border-dark-700 rounded-lg max-h-56 overflow-y-auto mb-3">
          {searching && <p className="text-xs text-slate-500 p-3">{t('common.loading')}</p>}
          {!searching && results.length === 0 && (
            <p className="text-xs text-slate-500 italic p-3">{t('endCustomerReview.linkNoResults')}</p>
          )}
          {results.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => setPicked(r)}
              className={`w-full text-left px-3 py-2 text-xs border-b border-dark-700 last:border-b-0 transition-colors ${picked?.id === r.id ? 'bg-brand-600/30 text-slate-100' : 'text-slate-300 hover:bg-dark-700'}`}
            >
              <div className="font-medium">{r.company_name}</div>
              <div className="text-[10px] text-slate-500">
                {[r.city, r.country].filter(Boolean).join(', ') || '—'}
              </div>
            </button>
          ))}
        </div>
        <input
          className="input w-full"
          placeholder={t('endCustomerReview.notes')}
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
        <div className="flex gap-3 mt-4">
          <button onClick={() => onConfirm(picked.id, notes.trim() || null)} disabled={!picked || busy}
            className="btn-primary bg-blue-600 hover:bg-blue-500 flex-1 text-sm disabled:opacity-40">
            {busy ? t('common.loading') : t('endCustomerReview.linkExisting')}
          </button>
          <button onClick={onCancel} className="btn-secondary flex-1 text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Single suggestion card ───────────────────────────────────────────────────
function SuggestionCard({ item, isFocused, onFocus, onApprove, onLink, onReject, onUndo, t }) {
  const partner = item.partner;
  const reviewed = item.reviewed;

  return (
    <div
      onClick={onFocus}
      className={`card transition-all cursor-pointer ${isFocused ? 'ring-2 ring-brand-500/60' : ''}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 font-mono">{item.ref_no || '—'}</span>
          <span className="text-xs text-slate-600">·</span>
          <span className="text-xs text-slate-500">
            {item.tarih ? new Date(item.tarih).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
          </span>
        </div>
      </div>

      {/* Partner */}
      <div className="mb-3 bg-dark-800/60 border border-dark-700 rounded-lg p-3">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{t('endCustomerReview.partner')}</p>
        <p className="text-slate-100 font-medium text-sm">{partner?.company_name || '—'}</p>
        <p className="text-xs text-slate-400 mt-0.5">
          {[partner?.country, partner?.partner_subtype, partner?.assigned_to_name, partner?.quote_count != null && `${partner.quote_count} ${t('endCustomerReview.quotes')}`]
            .filter(Boolean).join(' · ')}
        </p>
      </div>

      {/* Suggestion */}
      <div className="mb-3 bg-amber-500/5 border border-amber-500/30 rounded-lg p-3">
        <p className="text-[10px] uppercase tracking-wider text-amber-400/80 mb-1">{t('endCustomerReview.suggested')}</p>
        <p className="text-slate-100 font-medium text-sm">"{item.suggestion}"</p>
      </div>

      {/* Original aciklama + lokasyon */}
      <div className="mb-3 text-xs text-slate-400 space-y-1">
        <p><span className="text-slate-500">{t('endCustomerReview.originalDescription')}:</span> {item.original_aciklama || '—'}</p>
        <p>
          <span className="text-slate-500">{t('endCustomerReview.location')}:</span> {item.lokasyon || '—'}
          <span className="mx-2 text-slate-600">|</span>
          <span className="text-slate-500">{t('endCustomerReview.country')}:</span> {item.ulke || '—'}
        </p>
      </div>

      {/* Actions */}
      {!reviewed && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={e => { e.stopPropagation(); onApprove(); }} className="btn-primary bg-emerald-600 hover:bg-emerald-500 text-xs px-3 py-1.5">
            ✓ {t('endCustomerReview.createNew')}
          </button>
          <button onClick={e => { e.stopPropagation(); onLink(); }} className="btn-primary bg-blue-600 hover:bg-blue-500 text-xs px-3 py-1.5">
            🔗 {t('endCustomerReview.linkExisting')}
          </button>
          <button onClick={e => { e.stopPropagation(); onReject(); }} className="btn-secondary text-xs px-3 py-1.5">
            ✕ {t('endCustomerReview.reject')}
          </button>
        </div>
      )}

      {/* Reviewed footer */}
      {reviewed && (
        <div className="border-t border-dark-700 pt-3 mt-2 flex items-start gap-3">
          <div className="flex-1 text-xs">
            {item.end_customer ? (
              <p className="text-slate-300">
                <span className={item.end_customer.created_by_review ? 'text-emerald-400' : 'text-blue-400'}>
                  {item.end_customer.created_by_review ? `→ ${t('endCustomerReview.createdLabel')}: ` : `→ ${t('endCustomerReview.linkedLabel')}: `}
                </span>
                <a href={`/crm/${item.end_customer.id}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                  {item.end_customer.company_name}
                </a>
                {item.end_customer.country && <span className="text-slate-500"> ({item.end_customer.country})</span>}
              </p>
            ) : (
              <p className="text-slate-400">
                <span className="text-slate-500">→ {t('endCustomerReview.rejectedLabel')}:</span>{' '}
                {item.review_notes ? `"${item.review_notes}"` : <span className="italic text-slate-600">{t('endCustomerReview.noNotes')}</span>}
              </p>
            )}
          </div>
          <button onClick={e => { e.stopPropagation(); onUndo(); }} className="btn-secondary text-xs px-2 py-1">
            ↺ {t('endCustomerReview.undo')}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, onDone }) {
  useEffect(() => { const id = setTimeout(onDone, 2500); return () => clearTimeout(id); }, [onDone]);
  return (
    <div className="fixed bottom-6 right-6 bg-emerald-600 text-white text-sm px-4 py-2.5 rounded-lg shadow-xl z-50">
      ✓ {msg}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function EndCustomerReviewPage() {
  const { t } = useTranslation();
  const currentUser = useAuthStore(s => s.user);

  const [stats,    setStats]    = useState(null);
  const [items,    setItems]    = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(false);
  const [status,   setStatus]   = useState('pending');
  const [country,  setCountry]  = useState('');
  const [partnerId,setPartnerId]= useState('');
  const [search,   setSearch]   = useState('');
  const [page,     setPage]     = useState(1);
  const [options,  setOptions]  = useState({ countries: [], partners: [] });
  const [partnerSearch, setPartnerSearch] = useState('');
  const [partnerDropdownOpen, setPartnerDropdownOpen] = useState(false);

  const [focusedIdx, setFocusedIdx]   = useState(0);
  const [pendingAction, setPendingAction] = useState(null); // {kind:'approve'|'reject'|'link', item}
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const cardRefs = useRef([]);

  const limit = 20;

  const loadStats = useCallback(async () => {
    try {
      const params = {};
      if (country)   params.country    = country;
      if (partnerId) params.partner_id = partnerId;
      if (search.trim()) params.search = search.trim();
      const r = await api.get('/end-customer/stats', { params });
      setStats(r.data.data);
    } catch { /* ignore */ }
  }, [country, partnerId, search]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = { status, page, limit };
      if (country)   params.country    = country;
      if (partnerId) params.partner_id = partnerId;
      if (search.trim()) params.search = search.trim();
      const r = await api.get('/end-customer/suggestions', { params });
      setItems(r.data.data);
      setTotal(r.data.total);
      setFocusedIdx(idx => Math.min(idx, Math.max(0, r.data.data.length - 1)));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [status, country, partnerId, search, page]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [status, country, partnerId, search]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadItems(); }, [loadItems]);

  useEffect(() => {
    api.get('/end-customer/filter-options')
      .then(r => setOptions(r.data.data))
      .catch(() => { /* ignore */ });
  }, []);

  const filteredPartners = useMemo(() => {
    const q = partnerSearch.trim().toLowerCase();
    if (!q) return options.partners.slice(0, 50);
    return options.partners.filter(p => p.company_name.toLowerCase().includes(q)).slice(0, 50);
  }, [options.partners, partnerSearch]);

  async function handleApprove(item, body) {
    setBusy(true);
    try {
      await api.post(`/end-customer/suggestions/${item.id}/approve`, body);
      setToast(t('endCustomerReview.toast.approved'));
      setPendingAction(null);
      loadStats();
      loadItems();
    } catch (err) {
      setToast(err.response?.data?.error || t('common.error'));
    }
    finally { setBusy(false); }
  }

  async function handleReject(item, notes) {
    setBusy(true);
    try {
      await api.post(`/end-customer/suggestions/${item.id}/reject`, { notes });
      setToast(t('endCustomerReview.toast.rejected'));
      setPendingAction(null);
      loadStats();
      loadItems();
    } catch (err) {
      setToast(err.response?.data?.error || t('common.error'));
    }
    finally { setBusy(false); }
  }

  async function handleLink(item, existing_customer_id, notes) {
    setBusy(true);
    try {
      await api.post(`/end-customer/suggestions/${item.id}/link`, { existing_customer_id, notes });
      setToast(t('endCustomerReview.toast.linked'));
      setPendingAction(null);
      loadStats();
      loadItems();
    } catch (err) {
      setToast(err.response?.data?.error || t('common.error'));
    }
    finally { setBusy(false); }
  }

  async function handleUndo(item) {
    try {
      await api.post(`/end-customer/suggestions/${item.id}/undo`, {});
      setToast(t('endCustomerReview.toast.undone'));
      loadStats();
      loadItems();
    } catch (err) {
      setToast(err.response?.data?.error || t('common.error'));
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handler(e) {
      if (pendingAction) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const item = items[focusedIdx];
      if (!item) return;

      const k = e.key.toLowerCase();
      if (item.reviewed) {
        if (e.key === 'ArrowDown' || k === 'j') setFocusedIdx(i => Math.min(i + 1, items.length - 1));
        else if (e.key === 'ArrowUp' || k === 'k') setFocusedIdx(i => Math.max(i - 1, 0));
        return;
      }
      if (k === 'o' || k === 'y') {
        e.preventDefault();
        setPendingAction({ kind: 'approve', item });
      } else if (k === 'l') {
        e.preventDefault();
        setPendingAction({ kind: 'link', item });
      } else if (k === 'x' || k === 'r') {
        e.preventDefault();
        setPendingAction({ kind: 'reject', item });
      } else if (k === 'e') {
        e.preventDefault();
        setPendingAction({ kind: 'approve', item });  // same modal — user edits company_name
      } else if (e.key === 'ArrowDown' || k === 'j') {
        setFocusedIdx(i => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp' || k === 'k') {
        setFocusedIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'Escape') {
        setPendingAction(null);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items, focusedIdx, pendingAction]);

  useEffect(() => {
    cardRefs.current[focusedIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedIdx]);

  if (!['owner', 'coordinator'].includes(currentUser?.role)) {
    return <div className="p-6 text-slate-400">{t('admin.accessDenied')}</div>;
  }

  const selectedPartner = options.partners.find(p => p.id === partnerId);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-100">{t('endCustomerReview.title')}</h1>
        <p className="text-slate-400 text-sm mt-0.5">{t('endCustomerReview.subtitle')}</p>
      </div>

      <StatsRow stats={stats} t={t} />

      {/* Filters */}
      <div className="card mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex gap-1 bg-dark-800/60 rounded-lg p-1">
          {['pending', 'reviewed'].map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${status === s ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {t(`endCustomerReview.${s}`)}
            </button>
          ))}
        </div>

        <select className="input text-xs py-1.5" value={country} onChange={e => setCountry(e.target.value)}>
          <option value="">{t('endCustomerReview.allCountries')}</option>
          {options.countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Partner dropdown (searchable) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setPartnerDropdownOpen(o => !o)}
            className="input text-xs py-1.5 min-w-48 text-left"
          >
            {selectedPartner ? `${selectedPartner.company_name} (${selectedPartner.suggestion_count})` : t('endCustomerReview.allPartners')}
          </button>
          {partnerDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 z-30 w-72 bg-dark-800 border border-dark-600 rounded-lg shadow-xl max-h-72 overflow-y-auto">
              <input
                autoFocus
                className="input w-full m-2 mb-1"
                style={{ width: 'calc(100% - 1rem)' }}
                placeholder={t('endCustomerReview.partnerSearchPlaceholder')}
                value={partnerSearch}
                onChange={e => setPartnerSearch(e.target.value)}
              />
              <button
                type="button"
                onClick={() => { setPartnerId(''); setPartnerDropdownOpen(false); setPartnerSearch(''); }}
                className="w-full text-left text-xs px-3 py-1.5 text-slate-400 hover:bg-dark-700"
              >
                {t('endCustomerReview.allPartners')}
              </button>
              {filteredPartners.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setPartnerId(p.id); setPartnerDropdownOpen(false); setPartnerSearch(''); }}
                  className="w-full text-left text-xs px-3 py-1.5 text-slate-300 hover:bg-dark-700 border-t border-dark-700/50"
                >
                  <span className="text-slate-100">{p.company_name}</span>
                  <span className="text-slate-500 ml-1">({p.suggestion_count})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <input
          className="input flex-1 min-w-52 text-xs py-1.5"
          placeholder={t('endCustomerReview.searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <span className="text-xs text-slate-500">{total}</span>
      </div>

      <p className="text-xs text-slate-500 mb-3 italic">{t('endCustomerReview.keyboardHint')}</p>

      {loading && <p className="text-slate-500 text-sm">{t('common.loading')}</p>}
      {!loading && items.length === 0 && (
        <p className="text-slate-500 text-sm italic text-center py-10">{t('endCustomerReview.empty')}</p>
      )}
      <div className="space-y-3">
        {items.map((s, i) => (
          <div key={s.id} ref={el => (cardRefs.current[i] = el)}>
            <SuggestionCard
              item={s}
              isFocused={i === focusedIdx}
              onFocus={() => setFocusedIdx(i)}
              onApprove={() => setPendingAction({ kind: 'approve', item: s })}
              onLink={()    => setPendingAction({ kind: 'link',    item: s })}
              onReject={()  => setPendingAction({ kind: 'reject',  item: s })}
              onUndo={()    => handleUndo(s)}
              t={t}
            />
          </div>
        ))}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center gap-3 mt-4 justify-center">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
          >
            ← {t('endCustomerReview.prev')}
          </button>
          <span className="text-xs text-slate-400">{t('endCustomerReview.pageOf', { page, total: totalPages })}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
          >
            {t('endCustomerReview.next')} →
          </button>
        </div>
      )}

      {pendingAction?.kind === 'approve' && (
        <ApproveModal
          item={pendingAction.item}
          busy={busy}
          onCancel={() => setPendingAction(null)}
          onConfirm={body => handleApprove(pendingAction.item, body)}
          t={t}
        />
      )}
      {pendingAction?.kind === 'reject' && (
        <RejectModal
          busy={busy}
          onCancel={() => setPendingAction(null)}
          onConfirm={notes => handleReject(pendingAction.item, notes)}
          t={t}
        />
      )}
      {pendingAction?.kind === 'link' && (
        <LinkModal
          item={pendingAction.item}
          busy={busy}
          onCancel={() => setPendingAction(null)}
          onConfirm={(id, notes) => handleLink(pendingAction.item, id, notes)}
          t={t}
        />
      )}

      {toast && <Toast msg={toast} onDone={() => setToast('')} />}
    </div>
  );
}
