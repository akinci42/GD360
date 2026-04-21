import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore.js';
import api from '../utils/api.js';

const CATEGORIES = ['general', 'offer', 'technical', 'contract', 'other'];

const MIME_ICONS = {
  'application/pdf':                                                    '📄',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
  'application/msword':                                                 '📝',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊',
  'application/vnd.ms-excel':                                          '📊',
  'image/jpeg': '🖼️', 'image/png': '🖼️', 'image/webp': '🖼️',
};

function mimeIcon(mime) { return MIME_ICONS[mime] || '📎'; }
function fmtSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function FilesPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const canWrite = ['owner', 'coordinator', 'sales'].includes(user?.role);

  const [files,      setFiles]      = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [filterCat,  setFilterCat]  = useState('');
  const [toast,      setToast]      = useState('');
  const fileRef = useRef();

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterCat) params.category = filterCat;
      const r = await api.get('/files', { params });
      setFiles(r.data.data);
    } catch { /* handled */ } finally { setLoading(false); }
  }, [filterCat]);

  useEffect(() => { load(); }, [load]);

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('category', filterCat || 'general');
      await api.post('/files', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      showToast(t('files.toast.uploaded'));
      load();
    } catch { showToast('Upload failed'); } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDelete(id) {
    if (!confirm(t('files.deleteConfirm'))) return;
    try {
      await api.delete(`/files/${id}`);
      setFiles(f => f.filter(x => x.id !== id));
      showToast(t('files.toast.deleted'));
    } catch { /* handled */ }
  }

  function handleDownload(file) {
    window.open(`${import.meta.env.VITE_API_URL}/files/${file.id}/download`, '_blank');
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">{t('files.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{files.length} {t('files.filesTotal')}</p>
        </div>
        {canWrite && (
          <>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="btn-primary"
            >
              {uploading ? t('common.loading') : t('files.upload')}
            </button>
            <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />
          </>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterCat('')}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
            filterCat === '' ? 'bg-brand-600 border-brand-600 text-white' : 'border-dark-600 text-slate-400 hover:text-slate-200'
          }`}
        >
          {t('files.allCategories')}
        </button>
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setFilterCat(cat)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              filterCat === cat ? 'bg-brand-600 border-brand-600 text-white' : 'border-dark-600 text-slate-400 hover:text-slate-200'
            }`}
          >
            {t(`files.categories.${cat}`)}
          </button>
        ))}
      </div>

      {/* File grid */}
      {loading ? (
        <div className="text-center py-16 text-slate-500">{t('common.loading')}</div>
      ) : files.length === 0 ? (
        <div className="text-center py-16 text-slate-600">{t('common.noData')}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {files.map(f => (
            <div key={f.id} className="bg-dark-800 border border-dark-700 rounded-xl p-4 hover:border-dark-600 transition-colors group">
              {/* Icon + name */}
              <div className="flex items-start gap-3">
                <span className="text-3xl flex-shrink-0">{mimeIcon(f.mime_type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate" title={f.file_name}>{f.file_name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{fmtSize(f.file_size)}</p>
                </div>
              </div>

              {/* Category badge */}
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs px-2 py-0.5 rounded-full bg-dark-700 text-slate-400">
                  {t(`files.categories.${f.category}`)}
                </span>
                <span className="text-xs text-slate-600">
                  {new Date(f.created_at).toLocaleDateString()}
                </span>
              </div>

              {/* Uploader */}
              {f.uploader_name && (
                <p className="text-xs text-slate-600 mt-1 truncate">{f.uploader_name}</p>
              )}

              {/* Actions */}
              <div className="mt-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleDownload(f)}
                  className="flex-1 text-xs py-1.5 rounded-lg bg-dark-700 text-slate-300 hover:bg-dark-600 transition-colors"
                >
                  {t('files.download')}
                </button>
                {canWrite && (
                  <button
                    onClick={() => handleDelete(f.id)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-dark-700 text-red-400 hover:bg-red-500/20 transition-colors"
                  >
                    {t('common.delete')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
