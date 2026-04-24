import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore.js';
import api from '../utils/api.js';

const MIN_SCORE_MIN  = 0.75;
const MIN_SCORE_STEP = 0.01;

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
      <Card label={t('crm.dedupe.pending')}  value={stats?.pending  ?? 0} color="border-l-4 border-amber-500/60" />
      <Card label={t('crm.dedupe.merged')}   value={stats?.merged   ?? 0} color="border-l-4 border-emerald-500/60" />
      <Card label={t('crm.dedupe.rejected')} value={stats?.rejected ?? 0} color="border-l-4 border-slate-600" />
    </div>
  );
}

// ─── Customer side panel inside a pair card ───────────────────────────────────
function CustomerSide({ customer, side, isMaster, isFocusedCard, onPick, t }) {
  if (!customer) return <div className="flex-1 p-4 text-slate-500 italic">—</div>;
  const quoteCount = parseInt(customer.quote_count ?? 0);
  const lastQuote = customer.last_quote_date;
  const ring = isMaster ? 'ring-2 ring-emerald-500 border-emerald-500/50' : 'border-dark-600';
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex-1 text-left bg-dark-800/60 border rounded-lg p-3 transition-all ${ring} ${isFocusedCard ? 'hover:border-brand-500/50' : ''}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          {side}
        </span>
        {isMaster && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold">
            {t('crm.dedupe.master')}
          </span>
        )}
      </div>
      <p className="text-slate-100 font-medium text-sm mb-1 truncate">{customer.company_name}</p>
      <p className="text-xs text-slate-400 mb-1.5">
        {[customer.city, customer.country].filter(Boolean).join(', ') || '—'}
      </p>
      <div className="text-xs text-slate-500 space-y-0.5">
        <div>
          <span className="text-emerald-400 font-mono font-medium">{quoteCount}</span>
          {' · '}
          <span>{customer.assigned_to_name || t('crm.dedupe.noAssigned')}</span>
        </div>
        <div>
          {t('crm.dedupe.lastQuote')}: {lastQuote ? new Date(lastQuote).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
            : <span className="italic text-slate-600">{t('crm.dedupe.noQuote')}</span>}
        </div>
      </div>
    </button>
  );
}

// ─── Single pair card ─────────────────────────────────────────────────────────
function PairCard({ suggestion, masterPick, isFocused, onFocus, onPickSide, onMerge, onReject, t }) {
  const score = Math.round(parseFloat(suggestion.similarity_score) * 100);
  const masterSelected = masterPick === 'a' || masterPick === 'b';

  return (
    <div
      onClick={onFocus}
      className={`card transition-all cursor-pointer ${isFocused ? 'ring-2 ring-brand-500/60' : ''}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-base font-bold text-brand-300">%{score}</span>
          <span className="text-xs text-slate-500">{t('crm.dedupe.similarity').toLowerCase()}</span>
          <span className="text-xs text-slate-600">·</span>
          <span className="text-xs text-slate-500 font-mono">{suggestion.match_reason}</span>
        </div>
      </div>

      <div className="flex gap-3 mb-3">
        <CustomerSide
          customer={suggestion.customer_a}
          side="A"
          isMaster={masterPick === 'a'}
          isFocusedCard={isFocused}
          onPick={e => { e.stopPropagation(); onPickSide('a'); }}
          t={t}
        />
        <CustomerSide
          customer={suggestion.customer_b}
          side="B"
          isMaster={masterPick === 'b'}
          isFocusedCard={isFocused}
          onPick={e => { e.stopPropagation(); onPickSide('b'); }}
          t={t}
        />
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={e => { e.stopPropagation(); onReject(); }}
          className="btn-secondary text-xs px-3 py-1.5"
        >
          ✕ {t('crm.dedupe.keepSeparate')}
        </button>
        <a
          href={`/crm/${suggestion.customer_a?.id}`} target="_blank" rel="noreferrer"
          onClick={e => e.stopPropagation()}
          className="btn-secondary text-xs px-3 py-1.5"
        >
          ↗ A
        </a>
        <a
          href={`/crm/${suggestion.customer_b?.id}`} target="_blank" rel="noreferrer"
          onClick={e => e.stopPropagation()}
          className="btn-secondary text-xs px-3 py-1.5"
        >
          ↗ B
        </a>
        <button
          onClick={e => { e.stopPropagation(); onMerge(); }}
          disabled={!masterSelected}
          className={`btn-primary text-xs px-3 py-1.5 ml-auto ${!masterSelected ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          ⇆ {t('crm.dedupe.merge')} {masterSelected && `(${masterPick.toUpperCase()})`}
        </button>
      </div>
    </div>
  );
}

// ─── Confirm merge modal ──────────────────────────────────────────────────────
function ConfirmMergeModal({ suggestion, masterPick, onCancel, onConfirm, confirming, t }) {
  const master = masterPick === 'a' ? suggestion.customer_a : suggestion.customer_b;
  const other  = masterPick === 'a' ? suggestion.customer_b : suggestion.customer_a;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-[480px] max-w-full p-5">
        <h3 className="text-sm font-semibold text-slate-100 mb-2">{t('crm.dedupe.confirmMergeTitle')}</h3>
        <p className="text-sm text-slate-400 mb-4 leading-relaxed">
          {t('crm.dedupe.confirmMerge', { other: other?.company_name, master: master?.company_name })}
        </p>
        <div className="flex gap-3">
          <button onClick={onConfirm} disabled={confirming}
            className="btn-primary bg-emerald-600 hover:bg-emerald-500 flex-1 text-sm">
            {confirming ? t('common.loading') : t('crm.dedupe.merge')}
          </button>
          <button onClick={onCancel} className="btn-secondary flex-1 text-sm">
            {t('common.cancel')}
          </button>
        </div>
      </div>
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
export default function DedupePage() {
  const { t } = useTranslation();
  const currentUser = useAuthStore(s => s.user);

  const [stats,     setStats]     = useState(null);
  const [items,     setItems]     = useState([]);
  const [total,     setTotal]     = useState(0);
  const [loading,   setLoading]   = useState(false);
  const [status,    setStatus]    = useState('pending');
  const [minScore,  setMinScore]  = useState(0.75);
  const [search,    setSearch]    = useState('');
  const [masterPicks, setMasterPicks] = useState({});  // suggestionId -> 'a' | 'b'
  const [focusedIdx, setFocusedIdx]   = useState(0);
  const [pendingMerge, setPendingMerge] = useState(null);  // {suggestion, masterPick}
  const [confirming, setConfirming]   = useState(false);
  const [toast, setToast] = useState('');

  const cardRefs = useRef([]);

  async function loadStats() {
    try {
      const r = await api.get('/dedupe/stats');
      setStats(r.data.data);
    } catch { /* ignore */ }
  }

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = { status, min_score: minScore, limit: 50 };
      if (search.trim()) params.search = search.trim();
      const r = await api.get('/dedupe/suggestions', { params });
      setItems(r.data.data);
      setTotal(r.data.total);
      setFocusedIdx(idx => Math.min(idx, Math.max(0, r.data.data.length - 1)));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [status, minScore, search]);

  useEffect(() => { loadStats(); }, []);
  useEffect(() => { loadItems(); }, [loadItems]);

  async function handleMerge(suggestion, pick) {
    if (!pick) return;
    const master_id = pick === 'a' ? suggestion.customer_a.id : suggestion.customer_b.id;
    setConfirming(true);
    try {
      await api.post(`/dedupe/suggestions/${suggestion.id}/merge`, { master_id });
      setItems(its => its.filter(i => i.id !== suggestion.id));
      setMasterPicks(mp => {
        const { [suggestion.id]: _discard, ...rest } = mp;
        return rest;
      });
      setToast(t('crm.dedupe.toast.merged'));
      loadStats();
      setPendingMerge(null);
    } catch { /* ignore */ }
    finally { setConfirming(false); }
  }

  async function handleReject(suggestion) {
    try {
      await api.post(`/dedupe/suggestions/${suggestion.id}/reject`, {});
      setItems(its => its.filter(i => i.id !== suggestion.id));
      setToast(t('crm.dedupe.toast.rejected'));
      loadStats();
    } catch { /* ignore */ }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handler(e) {
      if (pendingMerge) return;  // let the modal take keys
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const card = items[focusedIdx];
      if (!card) return;

      const k = e.key.toLowerCase();
      if (k === 'a' || k === 'b') {
        setMasterPicks(mp => ({ ...mp, [card.id]: k }));
      } else if (e.key === ' ') {
        e.preventDefault();
        const pick = masterPicks[card.id];
        if (pick) setPendingMerge({ suggestion: card, masterPick: pick });
      } else if (k === 'x') {
        handleReject(card);
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        setFocusedIdx(idx => Math.min(idx + 1, items.length - 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        setFocusedIdx(idx => Math.max(idx - 1, 0));
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, focusedIdx, masterPicks, pendingMerge]);

  // Scroll focused card into view
  useEffect(() => {
    cardRefs.current[focusedIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedIdx]);

  if (!['owner', 'coordinator'].includes(currentUser?.role)) {
    return <div className="p-6 text-slate-400">{t('admin.accessDenied')}</div>;
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-100">{t('crm.dedupe.title')}</h1>
        <p className="text-slate-400 text-sm mt-0.5">{t('crm.dedupe.subtitle')}</p>
      </div>

      <StatsRow stats={stats} t={t} />

      {/* Filters */}
      <div className="card mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex gap-1 bg-dark-800/60 rounded-lg p-1">
          {['pending', 'merged', 'rejected'].map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${status === s ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {t(`crm.dedupe.${s}`)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>{t('crm.dedupe.minScore')}:</span>
          <input
            type="range"
            min={MIN_SCORE_MIN} max={1} step={MIN_SCORE_STEP}
            value={minScore}
            onChange={e => setMinScore(parseFloat(e.target.value))}
            className="w-32"
          />
          <span className="text-slate-200 font-mono w-10 text-right">{minScore.toFixed(2)}</span>
        </div>

        <input
          className="input flex-1 min-w-52"
          placeholder={t('crm.dedupe.searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <span className="text-xs text-slate-500">{total} {t('crm.dedupe.pending').toLowerCase()}</span>
      </div>

      <p className="text-xs text-slate-500 mb-3 italic">{t('crm.dedupe.keyboardHint')}</p>

      {/* List */}
      {loading && <p className="text-slate-500 text-sm">{t('common.loading')}</p>}
      {!loading && items.length === 0 && (
        <p className="text-slate-500 text-sm italic text-center py-10">{t('crm.dedupe.empty')}</p>
      )}
      <div className="space-y-3">
        {items.map((s, i) => (
          <div key={s.id} ref={el => (cardRefs.current[i] = el)}>
            <PairCard
              suggestion={s}
              masterPick={masterPicks[s.id]}
              isFocused={i === focusedIdx}
              onFocus={() => setFocusedIdx(i)}
              onPickSide={side => setMasterPicks(mp => ({ ...mp, [s.id]: side }))}
              onMerge={() => {
                const pick = masterPicks[s.id];
                if (pick) setPendingMerge({ suggestion: s, masterPick: pick });
              }}
              onReject={() => handleReject(s)}
              t={t}
            />
          </div>
        ))}
      </div>

      {pendingMerge && (
        <ConfirmMergeModal
          suggestion={pendingMerge.suggestion}
          masterPick={pendingMerge.masterPick}
          onCancel={() => setPendingMerge(null)}
          onConfirm={() => handleMerge(pendingMerge.suggestion, pendingMerge.masterPick)}
          confirming={confirming}
          t={t}
        />
      )}

      {toast && <Toast msg={toast} onDone={() => setToast('')} />}
    </div>
  );
}
