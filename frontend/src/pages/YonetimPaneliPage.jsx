import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore.js';
import api from '../utils/api.js';

// ─── Permission matrix (static, mirrors CLAUDE.md role definitions) ───────────
const MODULES = [
  { key: 'komutaMerkezi',       navKey: 'nav.komutaMerkezi' },
  { key: 'crm',                 navKey: 'nav.crm' },
  { key: 'salesRadar',          navKey: 'nav.salesRadar' },
  { key: 'activities',          navKey: 'nav.activities' },
  { key: 'teklifMerkezi',       navKey: 'nav.teklifMerkezi' },
  { key: 'konfigurator',        navKey: 'nav.konfigurator' },
  { key: 'dosyaMerkezi',        navKey: 'nav.dosyaMerkezi' },
  { key: 'performansPrim',      navKey: 'nav.performansPrim' },
  { key: 'iletisimBildirimler', navKey: 'nav.iletisimBildirimler' },
  { key: 'maliyetMerkezi',      navKey: 'nav.maliyetMerkezi' },
  { key: 'yonetimPaneli',       navKey: 'nav.yonetimPaneli' },
  { key: 'ustaBot',             navKey: 'nav.ustaBot' },
];

const PERM_MATRIX = {
  komutaMerkezi:       { owner: 'full', coordinator: 'full', sales: 'read', viewer: 'read' },
  crm:                 { owner: 'full', coordinator: 'full', sales: 'own',  viewer: 'read' },
  salesRadar:          { owner: 'full', coordinator: 'full', sales: 'own',  viewer: 'read' },
  activities:          { owner: 'full', coordinator: 'full', sales: 'own',  viewer: 'read' },
  teklifMerkezi:       { owner: 'full', coordinator: 'full', sales: 'own',  viewer: 'none' },
  konfigurator:        { owner: 'full', coordinator: 'full', sales: 'full', viewer: 'none' },
  dosyaMerkezi:        { owner: 'full', coordinator: 'full', sales: 'own',  viewer: 'read' },
  performansPrim:      { owner: 'full', coordinator: 'full', sales: 'none', viewer: 'none' },
  iletisimBildirimler: { owner: 'full', coordinator: 'full', sales: 'full', viewer: 'read' },
  maliyetMerkezi:      { owner: 'full', coordinator: 'full', sales: 'none', viewer: 'none' },
  yonetimPaneli:       { owner: 'full', coordinator: 'full', sales: 'none', viewer: 'none' },
  ustaBot:             { owner: 'full', coordinator: 'full', sales: 'full', viewer: 'full' },
};

const PERM_BADGE = {
  full: { label: '✓ Tam',   cls: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' },
  read: { label: '👁 Okuma', cls: 'bg-sky-500/20 text-sky-400 border border-sky-500/30' },
  own:  { label: '◉ Kendi', cls: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' },
  none: { label: '— Yok',   cls: 'bg-dark-700 text-slate-600 border border-dark-600' },
};

const ROLE_COLORS = {
  owner:       'bg-purple-500/20 text-purple-300 border border-purple-500/30',
  coordinator: 'bg-brand-500/20 text-brand-300 border border-brand-500/30',
  sales:       'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  viewer:      'bg-slate-500/20 text-slate-300 border border-slate-500/30',
};

// ─── Modal component ───────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700">
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none transition-colors">×</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ─── User form (add / edit) ────────────────────────────────────────────────────
function UserFormModal({ user, onClose, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    full_name: user?.full_name || '',
    email:     user?.email     || '',
    role:      user?.role      || 'sales',
    level:     user?.level     || 2,
    region:    user?.region    || '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, level: Number(form.level), region: form.region || null };
      if (user) {
        await api.put(`/admin/users/${user.id}`, payload);
      } else {
        await api.post('/admin/users', payload);
      }
      onSaved();
    } catch (err) {
      const msg = err.response?.data?.error || '';
      setError(msg.includes('already') ? t('admin.users.emailExists') : msg || 'Hata oluştu');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={user ? t('admin.users.editUser') : t('admin.users.addUser')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">{t('admin.users.fullName')}</label>
          <input
            className="input w-full"
            value={form.full_name}
            onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">{t('common.email')}</label>
          <input
            className="input w-full"
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            required
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-400 mb-1">Rol</label>
            <select
              className="input w-full"
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            >
              {['owner', 'coordinator', 'sales', 'viewer'].map(r => (
                <option key={r} value={r}>{t(`roles.${r}`)}</option>
              ))}
            </select>
          </div>
          <div className="w-24">
            <label className="block text-xs font-medium text-slate-400 mb-1">Level</label>
            <select
              className="input w-full"
              value={form.level}
              onChange={e => setForm(f => ({ ...f, level: e.target.value }))}
            >
              {[1, 2, 3, 4].map(l => (
                <option key={l} value={l}>L{l}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Bölge / Sorumluluk</label>
          <input
            className="input w-full"
            placeholder="örn. Türkiye, Özbekistan…"
            value={form.region}
            onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
          />
        </div>
        {!user && (
          <p className="text-xs text-slate-500">Varsayılan şifre ile oluşturulur: <span className="text-slate-300 font-mono">GD360!2024</span></p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="btn-primary flex-1">
            {saving ? t('common.loading') : t('common.save')}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary flex-1">{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Reset password modal ──────────────────────────────────────────────────────
function ResetPasswordModal({ user, onClose }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [saving,   setSaving]   = useState(false);
  const [done,     setDone]     = useState(false);
  const [error,    setError]    = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post(`/admin/users/${user.id}/reset-password`, { password: password || undefined });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Hata oluştu');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`${t('admin.users.resetPasswordTitle')} — ${user.full_name}`} onClose={onClose}>
      {done ? (
        <div className="text-center py-4">
          <div className="text-3xl mb-3">✓</div>
          <p className="text-emerald-400 font-medium">{t('admin.users.resetSuccess')}</p>
          <button onClick={onClose} className="btn-secondary mt-4 w-full">{t('common.cancel')}</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">{t('admin.users.newPassword')}</label>
            <input
              className="input w-full"
              type="password"
              placeholder="GD360!2024"
              value={password}
              onChange={e => setPassword(e.target.value)}
              minLength={8}
            />
            <p className="text-xs text-slate-500 mt-1">{t('admin.users.defaultPasswordHint')}</p>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? t('common.loading') : t('admin.users.resetPassword')}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1">{t('common.cancel')}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function YonetimPaneliPage() {
  const { t } = useTranslation();
  const currentUser = useAuthStore(s => s.user);

  const [activeTab,    setActiveTab]    = useState('users');
  const [users,        setUsers]        = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [showAddEdit,  setShowAddEdit]  = useState(false);
  const [editingUser,  setEditingUser]  = useState(null);
  const [resetUser,    setResetUser]    = useState(null);
  const [toast,        setToast]        = useState('');

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/users');
      setUsers(r.data.data);
    } catch {
      // handled by axios interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function toggleStatus(user) {
    try {
      await api.patch(`/admin/users/${user.id}/status`, { is_active: !user.is_active });
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_active: !u.is_active } : u));
      showToast(t('admin.users.saveSuccess'));
    } catch {
      // silently fail — toast not needed
    }
  }

  if (!['owner', 'coordinator'].includes(currentUser?.role)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-5xl mb-4">🔐</div>
          <p className="text-slate-400">{t('admin.accessDenied')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{t('admin.title')}</h1>
          <p className="text-slate-400 text-sm mt-0.5">{users.length} kullanıcı</p>
        </div>
        {activeTab === 'users' && (
          <button
            className="btn-primary"
            onClick={() => { setEditingUser(null); setShowAddEdit(true); }}
          >
            + {t('admin.users.addUser')}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-dark-800 p-1 rounded-lg w-fit border border-dark-700">
        {['users', 'permissions'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-brand-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t(`admin.tabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* ── USERS TAB ── */}
      {activeTab === 'users' && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">{t('admin.users.fullName')}</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">{t('common.email')}</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Rol / Lvl</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Bölge</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">{t('common.status')}</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">{t('admin.users.lastLogin')}</th>
                <th className="text-right px-4 py-3 text-slate-400 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="text-center py-10 text-slate-500">{t('common.loading')}</td></tr>
              )}
              {!loading && users.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-slate-500">{t('common.noData')}</td></tr>
              )}
              {users.map(u => (
                <tr key={u.id} className={`border-b border-dark-700/50 transition-colors ${u.is_active ? 'hover:bg-dark-700/30' : 'opacity-50 hover:bg-dark-700/20'}`}>
                  {/* Avatar + name */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand-700/60 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-brand-200">{u.full_name?.charAt(0)}</span>
                      </div>
                      <span className="text-slate-100 font-medium">{u.full_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400 font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[u.role]}`}>
                        {t(`roles.${u.role}`)}
                      </span>
                      {u.level && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-dark-600 text-slate-400 font-mono">
                          L{u.level}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs max-w-[160px]">
                    <span className="truncate block" title={u.region || '—'}>{u.region || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      u.is_active
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-red-500/20 text-red-400 border border-red-500/30'
                    }`}>
                      {u.is_active ? t('admin.users.active') : t('admin.users.inactive')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {u.last_login_at
                      ? new Date(u.last_login_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
                      : <span className="italic">{t('admin.users.never')}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {/* Edit */}
                      <button
                        title={t('common.edit')}
                        onClick={() => { setEditingUser(u); setShowAddEdit(true); }}
                        className="text-slate-400 hover:text-brand-400 transition-colors text-base leading-none"
                      >✎</button>
                      {/* Reset password */}
                      <button
                        title={t('admin.users.resetPassword')}
                        onClick={() => setResetUser(u)}
                        className="text-slate-400 hover:text-amber-400 transition-colors text-sm"
                      >🔑</button>
                      {/* Toggle active */}
                      {u.id !== currentUser.id && (
                        <button
                          title={u.is_active ? t('admin.users.deactivate') : t('admin.users.activate')}
                          onClick={() => toggleStatus(u)}
                          className={`text-sm transition-colors ${u.is_active ? 'text-slate-400 hover:text-red-400' : 'text-slate-600 hover:text-emerald-400'}`}
                        >
                          {u.is_active ? '⏸' : '▶'}
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

      {/* ── PERMISSION MATRIX TAB ── */}
      {activeTab === 'permissions' && (
        <div>
          <div className="mb-3">
            <h2 className="text-base font-semibold text-slate-100">{t('admin.permissions.title')}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{t('admin.permissions.subtitle')}</p>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 mb-4">
            {Object.entries(PERM_BADGE).map(([key, { label, cls }]) => (
              <span key={key} className={`text-xs px-2.5 py-1 rounded-full font-medium ${cls}`}>{label}</span>
            ))}
          </div>

          <div className="card p-0 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-dark-700">
                  <th className="text-left px-4 py-3 text-slate-400 font-medium w-52">{t('admin.permissions.module')}</th>
                  {['owner', 'coordinator', 'sales', 'viewer'].map(role => (
                    <th key={role} className="text-center px-4 py-3 font-medium">
                      <span className={`text-xs px-2.5 py-1 rounded-full ${ROLE_COLORS[role]}`}>
                        {t(`roles.${role}`)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MODULES.map((mod, idx) => {
                  const perms = PERM_MATRIX[mod.key];
                  return (
                    <tr
                      key={mod.key}
                      className={`border-b border-dark-700/50 ${idx % 2 === 0 ? '' : 'bg-dark-700/10'}`}
                    >
                      <td className="px-4 py-2.5 text-slate-300 font-medium">{t(mod.navKey)}</td>
                      {['owner', 'coordinator', 'sales', 'viewer'].map(role => {
                        const level = perms[role];
                        const { label, cls } = PERM_BADGE[level];
                        return (
                          <td key={role} className="px-4 py-2.5 text-center">
                            <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
                              {label}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {showAddEdit && (
        <UserFormModal
          user={editingUser}
          onClose={() => { setShowAddEdit(false); setEditingUser(null); }}
          onSaved={() => { setShowAddEdit(false); setEditingUser(null); loadUsers(); showToast(t('admin.users.saveSuccess')); }}
        />
      )}
      {resetUser && (
        <ResetPasswordModal
          user={resetUser}
          onClose={() => setResetUser(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50 transition-all">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
