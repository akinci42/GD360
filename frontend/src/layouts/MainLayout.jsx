import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore.js';
import { useState, useEffect } from 'react';
import api from '../utils/api.js';

const NAV_ITEMS = [
  { key: 'komutaMerkezi',  path: '/dashboard',    roles: ['owner', 'coordinator', 'sales', 'viewer'] },
  { key: 'crm',            path: '/crm',           roles: ['owner', 'coordinator', 'sales', 'viewer'] },
  { key: 'salesRadar',     path: '/sales-radar',   roles: ['owner', 'coordinator', 'sales', 'viewer'] },
  { key: 'activities',     path: '/activities',    roles: ['owner', 'coordinator', 'sales', 'viewer'] },
  { key: 'teklifMerkezi',  path: '/teklifler',     roles: ['owner', 'coordinator', 'sales'] },
  { key: 'konfigurator',   path: '/konfigurator',  roles: ['owner', 'coordinator', 'sales'] },
  { key: 'dosyaMerkezi',   path: '/dosyalar',      roles: ['owner', 'coordinator', 'sales', 'viewer'] },
  { key: 'performansPrim', path: '/performans',    roles: ['owner', 'coordinator'] },
  { key: 'iletisimBildirimler', path: '/iletisim', roles: ['owner', 'coordinator', 'sales', 'viewer'] },
  { key: 'maliyetMerkezi', path: '/maliyet',       roles: ['owner', 'coordinator'] },
  { key: 'yonetimPaneli',  path: '/yonetim',       roles: ['owner', 'coordinator'] },
  { key: 'ustaBot',        path: '/ustabot',       roles: ['owner', 'coordinator', 'sales', 'viewer'] },
];

const ICONS = {
  komutaMerkezi:   '◈',
  crm:             '👥',
  salesRadar:      '📡',
  activities:      '⚡',
  teklifMerkezi:   '📄',
  konfigurator:    '⚙️',
  dosyaMerkezi:    '🗂️',
  performansPrim:  '🏆',
  iletisimBildirimler: '💬',
  maliyetMerkezi:  '💰',
  yonetimPaneli:   '🔐',
  ustaBot:         '🤖',
};

export default function MainLayout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, clearAuth } = useAuthStore();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    async function fetchUnread() {
      try {
        const r = await api.get('/notifications', { params: { unread_only: true, limit: 1 } });
        setUnread(r.data.meta?.unread || 0);
      } catch { /* ignore */ }
    }
    fetchUnread();
    const interval = setInterval(fetchUnread, 60_000);
    return () => clearInterval(interval);
  }, []);

  function logout() {
    clearAuth();
    navigate('/login');
  }

  const visibleItems = NAV_ITEMS.filter(item => item.roles.includes(user?.role));

  return (
    <div className="flex h-screen bg-dark-900 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-dark-800 border-r border-dark-700 flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-dark-700">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-white">GD</span>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-100 leading-none">GDSales360</p>
            <p className="text-xs text-slate-500 mt-0.5">v0.1.0</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {visibleItems.map(item => (
            <NavLink
              key={item.key}
              to={item.path}
              end={item.path !== '/crm'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg mb-0.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-brand-600/20 text-brand-400 font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-dark-700'
                }`
              }
            >
              <span className="text-base w-5 text-center">{ICONS[item.key]}</span>
              <span className="flex-1">{t(`nav.${item.key}`)}</span>
              {item.key === 'iletisimBildirimler' && unread > 0 && (
                <span className="text-xs bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Language switcher */}
        <div className="px-3 py-2 border-t border-dark-700">
          <div className="flex gap-1 flex-wrap">
            {['tr', 'en', 'ru', 'ar', 'fr'].map(lang => (
              <button
                key={lang}
                onClick={() => { i18n.changeLanguage(lang); localStorage.setItem('gd360-lang', lang); }}
                className={`text-xs px-2 py-1 rounded font-medium uppercase transition-colors ${
                  i18n.language === lang ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>

        {/* User */}
        <div className="px-3 py-3 border-t border-dark-700 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-700 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-white">
              {user?.full_name?.charAt(0) || '?'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-200 truncate">{user?.full_name}</p>
            <p className="text-xs text-slate-500 truncate">{t(`roles.${user?.role}`)}</p>
          </div>
          <button onClick={logout} className="text-slate-500 hover:text-red-400 transition-colors" title={t('auth.logout')}>
            ⏻
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
