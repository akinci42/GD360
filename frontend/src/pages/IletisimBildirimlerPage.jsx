import { useState, useMemo } from 'react';
import { useAuthStore } from '../store/authStore.js';

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp', icon: '📱', color: 'text-green-400' },
  { id: 'email',    label: 'E-posta',  icon: '📧', color: 'text-blue-400'  },
  { id: 'phone',    label: 'Telefon',  icon: '📞', color: 'text-yellow-400' },
];

const TEAM = [
  { id: 'orhan',   name: 'Orhan Demir'    },
  { id: 'sinan',   name: 'Sinan Kaya'     },
  { id: 'ramazan', name: 'Ramazan Yılmaz' },
  { id: 'sanzhar', name: 'Sanzhar Bekov'  },
  { id: 'sami',    name: 'Sami Arslan'    },
];

const FOLLOW_UP_STATUS = {
  completed:   { label: 'Tamamlandı',    cls: 'bg-green-500/15 text-green-400'  },
  pending:     { label: 'Bekliyor',       cls: 'bg-yellow-500/15 text-yellow-400' },
  overdue:     { label: 'Gecikmiş',       cls: 'bg-red-500/15 text-red-400'      },
  no_followup: { label: 'Takip Yok',     cls: 'bg-slate-700 text-slate-400'     },
};

const MOCK_COMMUNICATIONS = [
  { id: 1,  person: 'orhan',   customer: 'Büyük Değirmen A.Ş.',       channel: 'whatsapp', date: '2026-04-20 09:15', summary: 'Teklif hakkında görüşme, fiyat onayı bekleniyor.', followUp: 'pending'    },
  { id: 2,  person: 'sinan',   customer: 'Anadolu Un Fabrikası',       channel: 'email',    date: '2026-04-20 08:30', summary: 'Teknik şartname PDF gönderildi.',                  followUp: 'completed'  },
  { id: 3,  person: 'ramazan', customer: 'Karadeniz Gıda Ltd.',        channel: 'phone',    date: '2026-04-19 16:45', summary: 'Sözleşme şartları görüşüldü, avukata iletildi.',  followUp: 'no_followup' },
  { id: 4,  person: 'sanzhar', customer: 'Orta Asya Makine Co.',       channel: 'whatsapp', date: '2026-04-19 14:20', summary: 'Montaj tarihi için koordinasyon yapıldı.',         followUp: 'completed'  },
  { id: 5,  person: 'sami',    customer: 'Mavi Deniz İhracat',         channel: 'email',    date: '2026-04-19 11:00', summary: 'Ödeme planı teklifi gönderildi.',                  followUp: 'pending'    },
  { id: 6,  person: 'orhan',   customer: 'Türkiye Un Sanayii',         channel: 'phone',    date: '2026-04-18 17:30', summary: 'Yedek parça listesi talep edildi.',                followUp: 'overdue'    },
  { id: 7,  person: 'sinan',   customer: 'Ege Değirmen Sistemleri',    channel: 'whatsapp', date: '2026-04-18 15:10', summary: 'Demo videosu paylaşıldı, geri bildirim bekleniyor.', followUp: 'pending'  },
  { id: 8,  person: 'ramazan', customer: 'Doğu Tahıl A.Ş.',           channel: 'email',    date: '2026-04-18 09:45', summary: 'Revize teklif No.2 iletildi.',                    followUp: 'completed'  },
  { id: 9,  person: 'sanzhar', customer: 'Orta Asya Makine Co.',       channel: 'phone',    date: '2026-04-17 13:00', summary: 'Lojistik firma ile kargo koşulları netleştirildi.',followUp: 'completed'  },
  { id: 10, person: 'sami',    customer: 'İstanbul Endüstri Grubu',    channel: 'whatsapp', date: '2026-04-17 10:30', summary: 'Fabrika ziyareti planlandı: 25 Nisan saat 10:00.', followUp: 'pending'    },
  { id: 11, person: 'orhan',   customer: 'Büyük Değirmen A.Ş.',       channel: 'email',    date: '2026-04-16 16:00', summary: 'Garanti belgesi ve CE sertifikası iletildi.',      followUp: 'no_followup' },
  { id: 12, person: 'sinan',   customer: 'Batı Anadolu Gıda',         channel: 'phone',    date: '2026-04-16 11:15', summary: 'Müşteri 2. makine için teklif istedi.',           followUp: 'overdue'    },
  { id: 13, person: 'ramazan', customer: 'Karadeniz Gıda Ltd.',        channel: 'whatsapp', date: '2026-04-15 14:00', summary: 'Kurulum ekibi ulaşım bilgisi paylaşıldı.',         followUp: 'completed'  },
  { id: 14, person: 'sanzhar', customer: 'Özbekistan Tahıl İth. İhr.', channel: 'email',    date: '2026-04-15 09:00', summary: 'Döviz bazlı fiyat listesi PDF eki ile gönderildi.', followUp: 'pending'  },
  { id: 15, person: 'sami',    customer: 'Mavi Deniz İhracat',         channel: 'phone',    date: '2026-04-14 15:45', summary: 'Gümrük belgesi eksiklikleri giderildi.',           followUp: 'completed'  },
];

const PERSON_MAP = Object.fromEntries(TEAM.map(t => [t.id, t.name]));
const CHANNEL_MAP = Object.fromEntries(CHANNELS.map(c => [c.id, c]));

function StatusBadge({ status }) {
  const s = FOLLOW_UP_STATUS[status] ?? FOLLOW_UP_STATUS.no_followup;
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>;
}

export default function IletisimBildirimlerPage() {
  const { user } = useAuthStore();
  const isManager = ['owner', 'coordinator'].includes(user?.role);

  const [filterPerson,   setFilterPerson]   = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterChannel,  setFilterChannel]  = useState('');
  const [filterFollowUp, setFilterFollowUp] = useState('');
  const [dateFrom,       setDateFrom]       = useState('');
  const [dateTo,         setDateTo]         = useState('');

  const rows = useMemo(() => {
    let list = isManager
      ? MOCK_COMMUNICATIONS
      : MOCK_COMMUNICATIONS.filter(c => c.person === user?.username);

    if (filterPerson)   list = list.filter(c => c.person === filterPerson);
    if (filterCustomer) list = list.filter(c => c.customer.toLowerCase().includes(filterCustomer.toLowerCase()));
    if (filterChannel)  list = list.filter(c => c.channel === filterChannel);
    if (filterFollowUp) list = list.filter(c => c.followUp === filterFollowUp);
    if (dateFrom)       list = list.filter(c => c.date >= dateFrom);
    if (dateTo)         list = list.filter(c => c.date <= dateTo + ' 23:59');

    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [isManager, user, filterPerson, filterCustomer, filterChannel, filterFollowUp, dateFrom, dateTo]);

  const stats = useMemo(() => ({
    total:     MOCK_COMMUNICATIONS.length,
    pending:   MOCK_COMMUNICATIONS.filter(c => c.followUp === 'pending').length,
    overdue:   MOCK_COMMUNICATIONS.filter(c => c.followUp === 'overdue').length,
    completed: MOCK_COMMUNICATIONS.filter(c => c.followUp === 'completed').length,
  }), []);

  function clearFilters() {
    setFilterPerson(''); setFilterCustomer(''); setFilterChannel('');
    setFilterFollowUp(''); setDateFrom(''); setDateTo('');
  }

  const hasFilter = filterPerson || filterCustomer || filterChannel || filterFollowUp || dateFrom || dateTo;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">İletişim ve Bildirimler</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isManager ? 'Tüm ekibin iletişim geçmişi ve takip zinciri' : 'İletişim geçmişiniz'}
          </p>
        </div>
      </div>

      {/* KPI row — manager only */}
      {isManager && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Toplam',      value: stats.total,     cls: 'text-slate-200'  },
            { label: 'Tamamlandı',  value: stats.completed, cls: 'text-green-400'  },
            { label: 'Bekliyor',    value: stats.pending,   cls: 'text-yellow-400' },
            { label: 'Gecikmiş',    value: stats.overdue,   cls: 'text-red-400'    },
          ].map(k => (
            <div key={k.label} className="bg-dark-800 border border-dark-700 rounded-xl p-4 text-center">
              <p className={`text-2xl font-bold ${k.cls}`}>{k.value}</p>
              <p className="text-xs text-slate-500 mt-1">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="bg-dark-800 border border-dark-700 rounded-xl p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Person — manager only */}
          {isManager && (
            <select
              value={filterPerson}
              onChange={e => setFilterPerson(e.target.value)}
              className="bg-dark-900 border border-dark-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-brand-500"
            >
              <option value="">Tüm Ekip</option>
              {TEAM.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}

          {/* Customer */}
          <input
            type="text"
            placeholder="Müşteri ara..."
            value={filterCustomer}
            onChange={e => setFilterCustomer(e.target.value)}
            className="bg-dark-900 border border-dark-700 text-slate-300 text-sm rounded-lg px-3 py-2 placeholder-slate-600 focus:outline-none focus:border-brand-500"
          />

          {/* Channel */}
          <select
            value={filterChannel}
            onChange={e => setFilterChannel(e.target.value)}
            className="bg-dark-900 border border-dark-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-brand-500"
          >
            <option value="">Tüm Kanallar</option>
            {CHANNELS.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
          </select>

          {/* Follow-up status */}
          <select
            value={filterFollowUp}
            onChange={e => setFilterFollowUp(e.target.value)}
            className="bg-dark-900 border border-dark-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-brand-500"
          >
            <option value="">Tüm Durumlar</option>
            {Object.entries(FOLLOW_UP_STATUS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>

          {/* Date from */}
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="bg-dark-900 border border-dark-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-brand-500"
          />

          {/* Date to */}
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="bg-dark-900 border border-dark-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-brand-500"
          />
        </div>

        {hasFilter && (
          <button
            onClick={clearFilters}
            className="mt-3 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            ✕ Filtreleri temizle
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700 text-xs text-slate-500 uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-medium">Kanal</th>
                {isManager && <th className="text-left px-4 py-3 font-medium">Satış Temsilcisi</th>}
                <th className="text-left px-4 py-3 font-medium">Müşteri</th>
                <th className="text-left px-4 py-3 font-medium">Özet</th>
                <th className="text-left px-4 py-3 font-medium">Tarih</th>
                <th className="text-left px-4 py-3 font-medium">Takip Durumu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={isManager ? 6 : 5} className="text-center py-12 text-slate-600">
                    Kayıt bulunamadı
                  </td>
                </tr>
              ) : rows.map(row => {
                const ch = CHANNEL_MAP[row.channel];
                return (
                  <tr key={row.id} className="hover:bg-dark-700/50 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1.5 font-medium ${ch.color}`}>
                        <span>{ch.icon}</span>
                        <span className="text-xs">{ch.label}</span>
                      </span>
                    </td>
                    {isManager && (
                      <td className="px-4 py-3 text-slate-300">
                        {PERSON_MAP[row.person] ?? row.person}
                      </td>
                    )}
                    <td className="px-4 py-3 text-slate-200 font-medium max-w-[160px] truncate">
                      {row.customer}
                    </td>
                    <td className="px-4 py-3 text-slate-400 max-w-[260px]">
                      <span title={row.summary} className="line-clamp-2">{row.summary}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {row.date}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.followUp} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {rows.length > 0 && (
          <div className="px-4 py-3 border-t border-dark-700 text-xs text-slate-600">
            {rows.length} kayıt gösteriliyor
          </div>
        )}
      </div>
    </div>
  );
}
