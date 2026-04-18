import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../utils/api.js';

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'on_hold'];

const STAGE_COLORS = {
  lead: 'border-slate-500',
  qualified: 'border-blue-500',
  proposal: 'border-yellow-500',
  negotiation: 'border-orange-500',
  won: 'border-green-500',
  lost: 'border-red-500',
  on_hold: 'border-purple-500',
};

const STAGE_BG = {
  lead: 'bg-slate-500/10',
  qualified: 'bg-blue-500/10',
  proposal: 'bg-yellow-500/10',
  negotiation: 'bg-orange-500/10',
  won: 'bg-green-500/10',
  lost: 'bg-red-500/10',
  on_hold: 'bg-purple-500/10',
};

export default function SalesRadarPage() {
  const { t } = useTranslation();
  const [pipeline, setPipeline] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/opportunities/pipeline')
      .then(r => setPipeline(r.data.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-slate-400">{t('common.loading')}</div>;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-100">{t('nav.salesRadar')}</h1>
        <button className="btn-primary">{t('common.add')} Fırsat</button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.filter(s => !['won', 'lost'].includes(s)).map(stage => {
          const cards = pipeline[stage] || [];
          const totalValue = cards.reduce((sum, c) => sum + (parseFloat(c.value) || 0), 0);
          return (
            <div key={stage} className="flex-shrink-0 w-64">
              <div className={`rounded-t-lg px-3 py-2 border-t-2 ${STAGE_COLORS[stage]} ${STAGE_BG[stage]} flex items-center justify-between mb-2`}>
                <span className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                  {t(`pipeline.${stage === 'on_hold' ? 'onHold' : stage}`)}
                </span>
                <span className="text-xs text-slate-400 bg-dark-700 rounded-full px-2 py-0.5">{cards.length}</span>
              </div>
              <div className="space-y-2 min-h-[200px]">
                {cards.map(opp => (
                  <div key={opp.id} className="card p-3 cursor-pointer hover:border-brand-600 transition-colors">
                    <p className="text-sm font-medium text-slate-100 truncate">{opp.title}</p>
                    <p className="text-xs text-slate-400 truncate mt-0.5">{opp.company_name}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-brand-400 font-medium">
                        {opp.value ? `$${Number(opp.value).toLocaleString()}` : '—'}
                      </span>
                      {opp.probability != null && (
                        <span className="text-xs text-slate-500">%{opp.probability}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {totalValue > 0 && (
                <div className="mt-2 text-xs text-slate-500 text-right">
                  Toplam: ${totalValue.toLocaleString()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
