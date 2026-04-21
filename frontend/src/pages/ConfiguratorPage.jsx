import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import api from '../utils/api.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n, currency = 'USD') {
  if (!n || isNaN(n)) return `${currency} 0.00`;
  return `${currency} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Toast({ msg, onDone }) {
  useEffect(() => { const id = setTimeout(onDone, 3000); return () => clearTimeout(id); }, [onDone]);
  return (
    <div className="fixed bottom-6 right-6 bg-emerald-600 text-white text-sm px-4 py-2.5 rounded-lg shadow-xl z-50">
      ✓ {msg}
    </div>
  );
}

// ─── Product Card ─────────────────────────────────────────────────────────────
function ProductCard({ product, inBasket, onAdd, onRemove, t }) {
  return (
    <div className={`card p-4 transition-all border ${inBasket ? 'border-brand-500/50' : 'border-transparent'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-200 truncate">{product.name}</p>
          {product.sku && <p className="text-xs text-slate-500 font-mono mt-0.5">{product.sku}</p>}
          {product.category && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-brand-600/20 text-brand-400 mt-1 inline-block">
              {product.category}
            </span>
          )}
          {product.description && (
            <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">{product.description}</p>
          )}
          <p className="text-sm font-semibold text-emerald-400 mt-2">
            {fmt(product.base_price, product.currency)} / {product.unit}
          </p>
        </div>
      </div>
      <div className="mt-3">
        {inBasket ? (
          <button
            onClick={onRemove}
            className="w-full text-xs py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
          >
            {t('configurator.removeFromBasket')}
          </button>
        ) : (
          <button
            onClick={onAdd}
            className="w-full text-xs py-1.5 rounded-lg bg-brand-600/20 text-brand-400 border border-brand-500/20 hover:bg-brand-600/30 transition-colors"
          >
            {t('configurator.addToBasket')}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Create Offer Modal ───────────────────────────────────────────────────────
function CreateOfferModal({ basket, customers, onClose, onCreated, t }) {
  const [form, setForm] = useState({ customer_id: '', title: '', validity_days: 30 });
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!form.customer_id || !form.title.trim()) return;
    setSaving(true);
    try {
      const items = basket.map(b => ({
        product_name: b.product.name,
        description:  b.product.description || '',
        quantity:     b.quantity,
        unit:         b.product.unit,
        unit_price:   b.unitPrice,
        discount_pct: 0,
      }));
      await api.post('/offers', {
        customer_id:   form.customer_id,
        title:         form.title,
        currency:      basket[0]?.product.currency || 'USD',
        validity_days: form.validity_days,
        items,
      });
      onCreated();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-40 px-4">
      <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-600">
          <h2 className="text-base font-semibold text-slate-100">{t('configurator.createOffer')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="form-label">{t('offers.customer')} *</label>
            <select className="input" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
              <option value="">{t('common.select')}…</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">{t('offers.titleField')} *</label>
            <input
              className="input"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder={t('offers.titleField')}
            />
          </div>
          <div>
            <label className="form-label">{t('offers.validityDays')}</label>
            <input
              className="input" type="number" min="1"
              value={form.validity_days}
              onChange={e => setForm(f => ({ ...f, validity_days: parseInt(e.target.value) || 30 }))}
            />
          </div>
          <div className="text-xs text-slate-400 bg-dark-700 rounded-lg p-3">
            {basket.length} {t('configurator.itemsInBasket')}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-dark-600">
          <button onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          <button
            onClick={create}
            disabled={saving || !form.customer_id || !form.title.trim()}
            className="btn-primary"
          >
            {saving ? t('common.loading') : t('configurator.createOffer')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Product Form Modal ───────────────────────────────────────────────────────
function ProductModal({ product, onClose, onSaved, t }) {
  const isEdit = !!product;
  const user = useAuthStore(s => s.user);
  const [form, setForm] = useState({
    name:        product?.name || '',
    sku:         product?.sku || '',
    category:    product?.category || '',
    description: product?.description || '',
    base_price:  product?.base_price || 0,
    currency:    product?.currency || 'USD',
    unit:        product?.unit || 'pcs',
    is_active:   product?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/products/${product.id}`, form);
      } else {
        await api.post('/products', form);
      }
      onSaved();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-40 px-4">
      <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-600">
          <h2 className="text-base font-semibold text-slate-100">
            {isEdit ? t('configurator.editProduct') : t('configurator.newProduct')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="form-label">{t('configurator.productName')} *</label>
              <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('configurator.sku')}</label>
              <input className="input" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('configurator.category')}</label>
              <input className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('configurator.basePrice')}</label>
              <input className="input text-right" type="number" min="0" step="0.01" value={form.base_price} onChange={e => setForm(f => ({ ...f, base_price: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('offers.currency')}</label>
              <select className="input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                {['USD','EUR','TRY','GBP','RUB'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">{t('offers.unit')}</label>
              <input className="input" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input
                type="checkbox" id="is_active"
                checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                className="accent-brand-500"
              />
              <label htmlFor="is_active" className="text-sm text-slate-300">{t('configurator.isActive')}</label>
            </div>
            <div className="col-span-2">
              <label className="form-label">{t('configurator.description')}</label>
              <textarea className="input resize-none" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-dark-600">
          <button onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          <button onClick={save} disabled={saving || !form.name.trim()} className="btn-primary">
            {saving ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ConfiguratorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const [products, setProducts]     = useState([]);
  const [categories, setCategories] = useState([]);
  const [customers, setCustomers]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [catFilter, setCatFilter]   = useState('');
  const [basket, setBasket]         = useState([]);   // [{product, quantity, unitPrice}]
  const [showOfferModal, setShowOfferModal]     = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [editProduct, setEditProduct]           = useState(null);
  const [toast, setToast] = useState('');

  const canManageProducts = ['owner','coordinator'].includes(user?.role);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes, cusRes] = await Promise.all([
        api.get('/products'),
        api.get('/products/categories'),
        api.get('/customers?limit=500'),
      ]);
      setProducts(pRes.data.data);
      setCategories(cRes.data.data);
      setCustomers(cusRes.data.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  function addToBasket(product) {
    setBasket(prev => {
      const exists = prev.find(b => b.product.id === product.id);
      if (exists) return prev;
      return [...prev, { product, quantity: 1, unitPrice: parseFloat(product.base_price) }];
    });
  }

  function removeFromBasket(productId) {
    setBasket(prev => prev.filter(b => b.product.id !== productId));
  }

  function setQty(productId, qty) {
    const q = Math.max(1, parseInt(qty) || 1);
    setBasket(prev => prev.map(b => b.product.id === productId ? { ...b, quantity: q } : b));
  }

  function setUnitPrice(productId, price) {
    setBasket(prev => prev.map(b => b.product.id === productId ? { ...b, unitPrice: parseFloat(price) || 0 } : b));
  }

  const basketTotal = basket.reduce((s, b) => s + b.quantity * b.unitPrice, 0);
  const currency = basket[0]?.product.currency || 'USD';

  const filtered = products.filter(p => {
    if (catFilter && p.category !== catFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !(p.sku || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function handleDelete(id) {
    if (!window.confirm(t('configurator.deleteConfirm'))) return;
    try {
      await api.delete(`/products/${id}`);
      setToast(t('configurator.toast.deleted'));
      loadProducts();
    } catch (e) { console.error(e); }
  }

  function onProductSaved() {
    setShowProductModal(false);
    setEditProduct(null);
    setToast(t('configurator.toast.saved'));
    loadProducts();
  }

  function onOfferCreated() {
    setShowOfferModal(false);
    setBasket([]);
    setToast(t('configurator.toast.offerCreated'));
    setTimeout(() => navigate('/teklifler'), 1500);
  }

  return (
    <div className="p-6 h-full flex flex-col space-y-5">
      {toast && <Toast msg={toast} onDone={() => setToast('')} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{t('nav.konfigurator')}</h1>
          <p className="text-sm text-slate-400 mt-0.5">{products.length} {t('configurator.productsTotal')}</p>
        </div>
        {canManageProducts && (
          <button onClick={() => { setEditProduct(null); setShowProductModal(true); }} className="btn-primary">
            {t('configurator.newProduct')}
          </button>
        )}
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        {/* ── LEFT: Catalog ── */}
        <div className="flex-1 flex flex-col min-w-0 space-y-4">
          {/* Search + Category filter */}
          <div className="flex gap-2 flex-wrap">
            <input
              className="input flex-1 min-w-[200px]"
              placeholder={t('configurator.searchProducts')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setCatFilter('')}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${catFilter === '' ? 'bg-brand-600 text-white' : 'bg-dark-700 text-slate-400 hover:text-slate-200'}`}
            >
              {t('configurator.allCategories')}
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCatFilter(cat)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${catFilter === cat ? 'bg-brand-600 text-white' : 'bg-dark-700 text-slate-400 hover:text-slate-200'}`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Products grid */}
          {loading ? (
            <p className="text-slate-400">{t('common.loading')}</p>
          ) : filtered.length === 0 ? (
            <div className="card py-10 text-center">
              <p className="text-slate-400">{t('configurator.noProducts')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 overflow-y-auto">
              {filtered.map(p => (
                <div key={p.id} className="relative">
                  <ProductCard
                    product={p}
                    inBasket={basket.some(b => b.product.id === p.id)}
                    onAdd={() => addToBasket(p)}
                    onRemove={() => removeFromBasket(p.id)}
                    t={t}
                  />
                  {canManageProducts && (
                    <div className="absolute top-2 right-2 flex gap-1">
                      <button
                        onClick={() => { setEditProduct(p); setShowProductModal(true); }}
                        className="text-xs text-slate-500 hover:text-brand-400 transition-colors bg-dark-700/80 px-1.5 py-0.5 rounded"
                      >
                        ✏
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="text-xs text-slate-500 hover:text-red-400 transition-colors bg-dark-700/80 px-1.5 py-0.5 rounded"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── RIGHT: Basket ── */}
        <div className="w-80 flex-shrink-0 flex flex-col space-y-4">
          <div className="card flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-200">{t('configurator.basket')}</h2>
              {basket.length > 0 && (
                <button onClick={() => setBasket([])} className="text-xs text-slate-500 hover:text-red-400 transition-colors">
                  {t('configurator.clearBasket')}
                </button>
              )}
            </div>

            {basket.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-slate-500 text-center">{t('configurator.emptyBasket')}</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
                {basket.map(b => (
                  <div key={b.product.id} className="border border-dark-600 rounded-lg p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-slate-200 leading-tight">{b.product.name}</p>
                      <button onClick={() => removeFromBasket(b.product.id)} className="text-slate-500 hover:text-red-400 text-xs flex-shrink-0">✕</button>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-xs text-slate-500">{t('configurator.qty')}</label>
                        <input
                          className="input text-sm py-1 text-center mt-0.5"
                          type="number" min="1"
                          value={b.quantity}
                          onChange={e => setQty(b.product.id, e.target.value)}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-slate-500">{t('offers.unitPrice')}</label>
                        <input
                          className="input text-sm py-1 text-right mt-0.5"
                          type="number" min="0" step="0.01"
                          value={b.unitPrice}
                          onChange={e => setUnitPrice(b.product.id, e.target.value)}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-emerald-400 text-right font-medium">
                      = {fmt(b.quantity * b.unitPrice, b.product.currency)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Total + CTA */}
            <div className="mt-4 pt-4 border-t border-dark-600 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">{t('configurator.total')}</span>
                <span className="text-lg font-bold text-slate-100">{fmt(basketTotal, currency)}</span>
              </div>
              <button
                onClick={() => setShowOfferModal(true)}
                disabled={basket.length === 0}
                className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('configurator.createOffer')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showOfferModal && (
        <CreateOfferModal
          basket={basket}
          customers={customers}
          onClose={() => setShowOfferModal(false)}
          onCreated={onOfferCreated}
          t={t}
        />
      )}

      {showProductModal && (
        <ProductModal
          product={editProduct}
          onClose={() => { setShowProductModal(false); setEditProduct(null); }}
          onSaved={onProductSaved}
          t={t}
        />
      )}
    </div>
  );
}
