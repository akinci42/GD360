#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GD360 Module Orchestrator
Kalan 6 modülü sırayla claude CLI ile uygular, checkpoint tutar, renkli cikti verir.
Kullanim: python orchestrator.py [--from TASK_ID]
"""

import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# Windows konsolunda UTF-8 cikti icin
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# ── ANSI Renkler ──────────────────────────────────────────────────────────────
G = '\033[92m'   # yeşil
R = '\033[91m'   # kırmızı
Y = '\033[93m'   # sarı
B = '\033[94m'   # mavi
C = '\033[96m'   # cyan
W = '\033[1m'    # bold
E = '\033[0m'    # reset

# ── Yollar ────────────────────────────────────────────────────────────────────
PROJECT_DIR  = Path(__file__).parent.resolve()
AGENT_DIR    = PROJECT_DIR / '.gd360-agent'
CKPT_FILE    = AGENT_DIR  / 'checkpoint.json'
LOGS_DIR     = AGENT_DIR  / 'logs'

# ── Helpers ───────────────────────────────────────────────────────────────────
def log(msg, color=E):
    print(f"{color}{msg}{E}", flush=True)

def ts():
    return datetime.now().strftime('%H:%M:%S')

def setup():
    AGENT_DIR.mkdir(exist_ok=True)
    LOGS_DIR.mkdir(exist_ok=True)
    # .gd360-agent dizinini gitignore et
    gi = PROJECT_DIR / '.gitignore'
    txt = gi.read_text(encoding='utf-8') if gi.exists() else ''
    if '.gd360-agent' not in txt:
        with open(gi, 'a', encoding='utf-8') as f:
            f.write('\n.gd360-agent/\n')
        log("  .gitignore güncellendi (.gd360-agent eklendi)", Y)

def load_ckpt():
    if CKPT_FILE.exists():
        return json.loads(CKPT_FILE.read_text(encoding='utf-8'))
    return {'completed': [], 'started_at': datetime.now().isoformat()}

def save_ckpt(ckpt):
    CKPT_FILE.write_text(json.dumps(ckpt, indent=2, ensure_ascii=False), encoding='utf-8')

def run_cmd(args, cwd=None, timeout=600, input_text=None):
    try:
        return subprocess.run(
            args, cwd=cwd or PROJECT_DIR,
            capture_output=True, text=True, encoding='utf-8', errors='replace',
            timeout=timeout, input=input_text
        )
    except subprocess.TimeoutExpired:
        return type('R', (), {'returncode': -1, 'stdout': '', 'stderr': 'TIMEOUT'})()
    except FileNotFoundError as e:
        return type('R', (), {'returncode': -1, 'stdout': '', 'stderr': str(e)})()

def find_claude():
    candidates = [
        shutil.which('claude'),
        str(Path.home() / 'AppData/Local/AnthropicClaude/claude.exe'),
        str(Path.home() / '.local/bin/claude'),
        '/usr/local/bin/claude',
    ]
    for c in candidates:
        if c and Path(c).exists():
            return c
    return 'claude'  # PATH'te olduğunu umut et

CLAUDE = find_claude()

def run_claude(prompt, task_id, attempt):
    log_file = LOGS_DIR / f"{task_id}_a{attempt}_{datetime.now().strftime('%H%M%S')}.log"
    log(f"  [{ts()}] Claude calisiyor (attempt {attempt}/3)... log -> {log_file.name}", C)
    result = run_cmd(
        [CLAUDE, '--dangerously-skip-permissions', '--print', '-p', prompt],
        timeout=900
    )
    output = (result.stdout or '') + '\n' + (result.stderr or '')
    log_file.write_text(output, encoding='utf-8', errors='replace')
    ok = result.returncode == 0
    if not ok:
        tail = output.strip()[-600:]
        log(f"  [!] Claude hata kodu {result.returncode}", R)
        log(f"  Son çıktı:\n{tail}", R)
    return ok, output

def run_migration():
    log(f"  [{ts()}] Migration çalıştırılıyor…", Y)
    r = run_cmd(
        ['docker-compose', 'exec', '-T', 'backend', 'npm', 'run', 'migrate'],
        timeout=120
    )
    if r.returncode != 0:
        log(f"  [!] Migration hatasi: {r.stderr.strip()[-300:]}", R)
        return False
    log(f"  [+] Migration basarili", G)
    return True

def git_commit(msg):
    run_cmd(['git', 'add', '-A'])
    full_msg = f"{msg}\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
    r = run_cmd(['git', 'commit', '-m', full_msg])
    if r.returncode == 0:
        log(f"  [+] Git commit OK", G)
        return True
    combined = (r.stdout + r.stderr).lower()
    if 'nothing to commit' in combined or 'no changes' in combined:
        log(f"  ~ Commit edilecek değişiklik yok", Y)
        return True
    log(f"  [!] Git commit hatasi: {r.stderr.strip()[-200:]}", R)
    return False

def check_docker():
    r = run_cmd(['docker-compose', 'ps', 'backend'], timeout=15)
    if r.returncode != 0 or 'Up' not in r.stdout:
        log("  ⚠ Backend container çalışmıyor — 'docker-compose up -d' önerilir", Y)

def print_status(tasks, ckpt):
    done = set(ckpt.get('completed', []))
    print(f"\n{W}{'='*52}{E}")
    print(f"{W}  GD360 Modul Durumu{E}")
    print(f"{W}{'='*52}{E}")
    for t in tasks:
        icon = f"{G}[OK]{E}" if t['id'] in done else f"{Y}[ ]{E}"
        at = ckpt.get(f"{t['id']}_completed_at", '')
        when = f"  {at[:16]}" if at else ''
        print(f"  {icon}  {t['name']}{when}")
    rem = sum(1 for t in tasks if t['id'] not in done)
    print(f"\n  Toplam: {len(tasks)}  Tamamlanan: {len(done)}  Kalan: {rem}")
    print(f"{W}{'='*52}{E}\n")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PROJE BAĞLAMI — her prompt'a prepend edilir
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CTX = r"""SEN GD360 PROJE GELİŞTİRİCİSİSIN. Aşağıdaki bağlamı kullan:

Proje dizini: C:\Projects\GD360
Stack: Node.js/Express 5 backend (ESM import syntax), PostgreSQL 16 + RLS, Redis 7, React 18 + Vite + Tailwind CSS v3

KRİTİK PATTERN — backend route şablonu:
  import { Router } from 'express';
  import { authenticate, requireRole } from '../middleware/auth.js';
  import { getRlsClient } from '../db/rls.js';
  const router = Router();
  router.use(authenticate);
  // endpoint:
  router.get('/', async (req, res, next) => {
    const client = await getRlsClient(req.user);
    try { ... res.json({success:true, data:...}); }
    catch(err) { next(err); } finally { client.release(); }
  });
  export default router;

KRİTİK PATTERN — frontend sayfa şablonu:
  import { useState, useEffect } from 'react';
  import { useTranslation } from 'react-i18next';
  import { useAuthStore } from '../store/authStore.js';
  import api from '../utils/api.js';  // axios, Bearer token otomatik

Tailwind dark tema class'ları: bg-dark-900 (sayfa), bg-dark-800 (card), bg-dark-700 (input bg),
  border-dark-600, text-slate-100/200/400/500, brand-600 (accent mavi-mor)
CSS utility (index.css'de mevcut): .card, .input, .form-label, .btn-primary, .btn-secondary

i18n: frontend/src/i18n/tr.js en.js ru.js ar.js fr.js — TÜM 5 DOSYAYA yeni section ekle
  (admin bloğundan önce, mevcut dosyayı okuyarak ekleme yap)

RLS migration SQL:
  current_setting('app.user_role', TRUE) IN ('owner','coordinator',...)
  current_setting('app.user_id', TRUE)::UUID = created_by
  set_updated_at() trigger fonksiyonu mevcut (önceki migrasyonlarda tanımlı)

backend/src/index.js'e router ekle:
  import XRouter from './routes/x.js';
  app.use('/api/v1/x', xRouter);

frontend/src/App.jsx'te route güncelle:
  import XPage from './pages/XPage.jsx';
  <Route path="x" element={<XPage />} />

ÖNCE dosyaları oku (Read tool), SONRA değiştir (Edit/Write tool).
Mevcut migrasyon: 001-007. Sıradaki numara her görevde belirtildi.
"""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# GÖREVLER
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASKS = [

  # ────────────────────────────────────────────────────
  {
    "id": "files",
    "name": "Dosya Merkezi",
    "has_migration": True,
    "commit_msg": "feat: Dosya Merkezi — multer upload API + file browser UI",
    "prompt": CTX + """
GÖREV: Dosya Merkezi modülünü uygula.

ADIM 1 — backend/migrations/008_files.sql oluştur:
  CREATE TABLE files (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    original_name TEXT        NOT NULL,
    stored_name   TEXT        NOT NULL,
    mime_type     TEXT,
    size_bytes    BIGINT      DEFAULT 0,
    customer_id   UUID        REFERENCES customers(id) ON DELETE SET NULL,
    opportunity_id UUID       REFERENCES opportunities(id) ON DELETE SET NULL,
    offer_id      UUID        REFERENCES offers(id) ON DELETE SET NULL,
    uploaded_by   UUID        NOT NULL REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_files_customer ON files(customer_id);
  CREATE INDEX idx_files_opp      ON files(opportunity_id);
  CREATE INDEX idx_files_uploader ON files(uploaded_by);
  ALTER TABLE files ENABLE ROW LEVEL SECURITY;
  CREATE POLICY files_select ON files FOR SELECT USING (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator','viewer')
    OR uploaded_by::TEXT = current_setting('app.user_id', TRUE)
  );
  CREATE POLICY files_insert ON files FOR INSERT WITH CHECK (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator','sales')
    AND uploaded_by::TEXT = current_setting('app.user_id', TRUE)
  );
  CREATE POLICY files_delete ON files FOR DELETE USING (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator')
    OR uploaded_by::TEXT = current_setting('app.user_id', TRUE)
  );

ADIM 2 — Multer kur ve backend/src/routes/files.js oluştur:
  Önce: docker-compose exec -T backend npm install multer --save
  Sonra dosya oluştur (ESM syntax):
  - import multer, path, fs, { fileURLToPath } from uygun modüller
  - diskStorage: destination = 'uploads/', filename = UUID + orijinal uzantı
  - limits: fileSize = 20 * 1024 * 1024
  - Endpoints:
    GET /           → dosya listesi (query: customer_id?, opportunity_id?, offer_id?)
                      JOIN users u ON u.id = f.uploaded_by, sırala created_at DESC
    POST /upload    → multer.single('file') → DB'ye kayıt, { success, data: fileRecord }
    GET /:id/download → res.download(path, original_name) ile dosya indir
    DELETE /:id     → DB'den sil + fs.unlink ile diskten sil

ADIM 3 — backend/src/index.js güncelle:
  - import filesRouter from './routes/files.js';
  - app.use('/api/v1/files', filesRouter);
  - Ayrıca: uploads klasörü yoksa oluştur (start fonksiyonunda fs.mkdirSync)
  - app.use('/uploads', express.static('uploads'));  (static file serving)

ADIM 4 — frontend/src/pages/FilesPage.jsx oluştur:
  - Header: "Dosya Merkezi" + "Dosya Yükle" butonu (hidden file input + label trigger)
  - Yükleme: FormData + api.post('/files/upload', formData, {onUploadProgress: e => setProgress(%)})
  - Progress bar animasyonu yükleme sırasında
  - Tablo sütunları: Dosya Adı, Boyut (KB/MB formatla), Yükleme Tarihi, Yükleyen, İşlemler
  - İndirme: anchor tag ile /uploads/{stored_name} veya api.get download
  - Silme: owner/coordinator veya kendi dosyaları
  - Boş durum mesajı, loading state
  - Dark tema, responsive

ADIM 5 — frontend/src/App.jsx:
  import FilesPage from './pages/FilesPage.jsx';
  <Route path="dosyalar" element={<FilesPage />} />  ← mevcut placeholder'ı değiştir

ADIM 6 — i18n: TÜM 5 DOSYAYA (tr/en/ru/ar/fr) files section ekle (admin'den önce):
  files: { title, upload, fileName, fileSize, uploadDate, uploadedBy,
           download, noFiles, uploading, deleteConfirm,
           toast: { uploaded, deleted } }
  TR değerleri: Dosya Merkezi, Dosya Yükle, Dosya Adı, Boyut, Yükleme Tarihi, Yükleyen,
                İndir, Dosya bulunamadı, Yükleniyor..., Bu dosyayı silmek istediğinizden emin misiniz?
                Yüklendi, Silindi
"""
  },

  # ────────────────────────────────────────────────────
  {
    "id": "performance",
    "name": "Performans & Prim",
    "has_migration": False,
    "commit_msg": "feat: Performans & Prim — aggregate reports API + leaderboard UI",
    "prompt": CTX + """
GÖREV: Performans & Prim modülünü uygula. Migration gerekmez.

ADIM 1 — backend/src/routes/reports.js oluştur:
  router.use(authenticate);

  GET /performance?period=month|quarter|year&user_id=?
  Dönen veri her satışçı için:
    { user_id, full_name, total_customers, active_opps, won_opps, won_value,
      lost_opps, win_rate (%), activities_count, avg_deal_size }
  Period filtresi: month=son 30 gün, quarter=son 90 gün, year=son 365 gün
  owner/coordinator → tüm satışçıları görür; sales → sadece kendini
  SQL: PostgreSQL FILTER(WHERE ...) ile tek sorguda aggregate

  GET /leaderboard?period=month
  Satışçıları won_value DESC sırala, rank ekle
  Sadece role='sales' AND is_active=true kullanıcılar

ADIM 2 — backend/src/index.js güncelle:
  import reportsRouter from './routes/reports.js';
  app.use('/api/v1/reports', reportsRouter);

ADIM 3 — frontend/src/pages/PerformansPage.jsx oluştur:
  - 3 period tab: Bu Ay / Bu Çeyrek / Bu Yıl
  - Tab değişince API'yi yeniden çek
  - Mevcut kullanıcı kartı: üstte büyük, performans metrikleri grid halinde
  - Leaderboard tablosu:
    * Sıra: 1=altın 🥇 2=gümüş 🥈 3=bronz 🥉 badge
    * Kullanıcı adı + avatar (baş harfi)
    * Won Fırsatlar (sayı)
    * Won Değer (para formatı)
    * Win Rate (% bar)
    * Aktivite Sayısı
  - Sales role: sadece kendi satırını göster (leaderboard hâlâ tam, ama my-row highlighted)
  - Owner/coordinator: tüm tablo + kullanıcı filtresi dropdown
  - Boş durum, loading state
  - Dark tema, responsive

ADIM 4 — frontend/src/App.jsx:
  import PerformansPage from './pages/PerformansPage.jsx';
  <Route path="performans" element={<PerformansPage />} />  ← placeholder güncelle

ADIM 5 — i18n TÜM 5 DOSYA performance section (admin'den önce):
  performance: { title, leaderboard, myPerformance,
    period: { month, quarter, year },
    rank, wonValue, wonCount, winRate, activities, avgDealSize,
    noData, allSalespeople }
  TR: Performans & Prim, Satışçı Sıralaması, Benim Performansım,
      Bu Ay, Bu Çeyrek, Bu Yıl, Sıra, Kazanılan Değer, Kazanılan Fırsat,
      Kazanma Oranı, Aktiviteler, Ort. Fırsat Değeri, Veri yok, Tüm Satışçılar
"""
  },

  # ────────────────────────────────────────────────────
  {
    "id": "notifications",
    "name": "Bildirimler",
    "has_migration": True,
    "commit_msg": "feat: Bildirimler — notification system + MainLayout badge + İletişim UI",
    "prompt": CTX + """
GÖREV: Bildirim sistemi uygula.

ADIM 1 — backend/migrations/009_notifications.sql:
  CREATE TABLE notifications (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT        NOT NULL CHECK (type IN ('opportunity_stage','followup_due','offer_sent','offer_accepted','system')),
    title       TEXT        NOT NULL,
    body        TEXT,
    entity_type TEXT,
    entity_id   UUID,
    is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_notif_user   ON notifications(user_id);
  CREATE INDEX idx_notif_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
  ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
  CREATE POLICY notif_own ON notifications FOR ALL
    USING  (user_id::TEXT = current_setting('app.user_id', TRUE))
    WITH CHECK (user_id::TEXT = current_setting('app.user_id', TRUE));

ADIM 2 — backend/src/routes/notifications.js oluştur:
  router.use(authenticate);
  GET /             → kullanıcının son 50 bildirimi (unread önce, sonra created_at DESC)
  GET /unread-count → { count: N }
  POST /            → bildirim oluştur (requireRole owner,coordinator; body: user_id, type, title, body)
  PATCH /:id/read   → is_read = true
  PATCH /read-all   → tüm kullanıcı bildirimlerini okundu işaretle
  DELETE /:id       → sil

ADIM 3 — backend/src/index.js güncelle:
  import notificationsRouter from './routes/notifications.js';
  app.use('/api/v1/notifications', notificationsRouter);

ADIM 4 — frontend/src/layouts/MainLayout.jsx güncelle:
  - İletişim nav item'ına unread count badge ekle (kırmızı daire, sayı)
  - useEffect ile component mount + 60sn interval → api.get('/notifications/unread-count')
  - count > 0 ise kırmızı badge göster (bg-red-500, text-white, text-xs rounded-full px-1.5)
  - count = 0 ise badge gizle

ADIM 5 — frontend/src/pages/IletisimBildirimlerPage.jsx'i gerçek veriyle yeniden yaz:
  - Bildirim listesi: api.get('/notifications') ile çek
  - "Tümünü Okundu İşaretle" butonu (unread varsa aktif)
  - Her bildirim: tip ikonu (📡 opportunity, ⚡ followup, 📄 offer, 🔔 system),
    başlık (okunmamışsa bold), body, tarih formatı ("X dakika/saat/gün önce")
  - Okunmamışlar: bg-brand-600/10 border-l-2 border-brand-500
  - Okunmuşlar: normal, biraz soluk
  - "Yeni Bildirim" modal (owner/coordinator): hedef kullanıcı dropdown, tip, başlık, içerik
  - Sağ üst: "Yeni Bildirim" butonu (owner/coordinator görür)
  - Boş durum: "Bildirim yok" mesajı

ADIM 6 — i18n TÜM 5 DOSYA notifications section (admin'den önce):
  notifications: { title, markAllRead, noNotifications, newNotification,
    targetUser, unread, read,
    types: { opportunity_stage, followup_due, offer_sent, offer_accepted, system },
    toast: { sent, markedRead } }
  TR: Bildirimler, Tümünü Okundu İşaretle, Bildirim yok, Yeni Bildirim,
      Hedef Kullanıcı, Okunmamış, Okunmuş,
      types: Fırsat Güncellendi, Takip Hatırlatması, Teklif Gönderildi, Teklif Kabul Edildi, Sistem
"""
  },

  # ────────────────────────────────────────────────────
  {
    "id": "costs",
    "name": "Maliyet Merkezi",
    "has_migration": True,
    "commit_msg": "feat: Maliyet Merkezi — cost tracking migration + CRUD API + dashboard UI",
    "prompt": CTX + """
GÖREV: Maliyet Merkezi modülünü uygula.

ADIM 1 — backend/migrations/010_costs.sql:
  CREATE TABLE cost_categories (
    id         UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT  NOT NULL UNIQUE,
    color      TEXT  DEFAULT '#64748b',
    created_by UUID  REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  INSERT INTO cost_categories (name, color) VALUES
    ('Nakliye','#3b82f6'),('Komisyon','#f59e0b'),
    ('Teknik Servis','#10b981'),('Pazarlama','#8b5cf6'),('Diğer','#64748b');

  CREATE TABLE costs (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id    UUID          REFERENCES cost_categories(id),
    title          TEXT          NOT NULL,
    amount         NUMERIC(15,2) NOT NULL,
    currency       TEXT          NOT NULL DEFAULT 'USD',
    cost_date      DATE          NOT NULL DEFAULT CURRENT_DATE,
    customer_id    UUID          REFERENCES customers(id) ON DELETE SET NULL,
    opportunity_id UUID          REFERENCES opportunities(id) ON DELETE SET NULL,
    notes          TEXT,
    created_by     UUID          NOT NULL REFERENCES users(id),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
  );
  CREATE TRIGGER costs_updated_at BEFORE UPDATE ON costs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  CREATE INDEX idx_costs_cat      ON costs(category_id);
  CREATE INDEX idx_costs_date     ON costs(cost_date);
  CREATE INDEX idx_costs_customer ON costs(customer_id);
  ALTER TABLE costs           ENABLE ROW LEVEL SECURITY;
  ALTER TABLE cost_categories ENABLE ROW LEVEL SECURITY;
  CREATE POLICY cost_cat_read  ON cost_categories FOR SELECT USING (TRUE);
  CREATE POLICY cost_cat_write ON cost_categories FOR ALL
    USING      (current_setting('app.user_role', TRUE) IN ('owner','coordinator'))
    WITH CHECK (current_setting('app.user_role', TRUE) IN ('owner','coordinator'));
  CREATE POLICY costs_select ON costs FOR SELECT USING (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator','viewer')
    OR created_by::TEXT = current_setting('app.user_id', TRUE)
  );
  CREATE POLICY costs_insert ON costs FOR INSERT WITH CHECK (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator','sales')
    AND created_by::TEXT = current_setting('app.user_id', TRUE)
  );
  CREATE POLICY costs_update ON costs FOR UPDATE USING (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator')
    OR created_by::TEXT = current_setting('app.user_id', TRUE)
  );
  CREATE POLICY costs_delete ON costs FOR DELETE USING (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator')
  );

ADIM 2 — backend/src/routes/costs.js oluştur:
  GET /categories         → tüm kategoriler
  GET /                   → costs listesi + aşağıdaki aggregate yanında:
    { data: [...], summary: { grand_total, by_category: [{name,color,total}] } }
    Query: category_id?, date_from?, date_to? (ISO date), customer_id?, page, limit
    JOIN cost_categories cc ON cc.id = c.category_id
    LEFT JOIN customers cu ON cu.id = c.customer_id
  POST /                  → yeni maliyet
  PATCH /:id              → güncelle
  DELETE /:id             → sil (owner/coordinator)

ADIM 3 — backend/src/index.js güncelle:
  import costsRouter from './routes/costs.js';
  app.use('/api/v1/costs', costsRouter);

ADIM 4 — frontend/src/pages/MaliyetPage.jsx oluştur:
  - 3 KPI kartı üstte: Bu Ay Toplam | Bu Yıl Toplam | Toplam Kayıt
  - Kategori breakdown: her kategori için renkli progress bar (toplam %'si)
  - Tarih aralığı filtresi dropdown: Bu Ay / Bu Çeyrek / Bu Yıl / Tüm Zamanlar
  - Maliyet tablosu: tarih, kategori (renkli badge), başlık, müşteri, tutar, işlemler
  - "Yeni Maliyet" modal: kategori dropdown, başlık, tutar, para birimi, tarih,
    müşteri (opsiyonel, arama dropdown), notlar
  - owner/coordinator: düzenle/sil butonları
  - Dark tema, responsive

ADIM 5 — frontend/src/App.jsx:
  import MaliyetPage from './pages/MaliyetPage.jsx';
  <Route path="maliyet" element={<MaliyetPage />} />  ← placeholder güncelle

ADIM 6 — i18n TÜM 5 DOSYA costs section (admin'den önce):
  costs: { title, newCost, category, amount, costDate, totalMonth, totalYear,
           totalRecords, breakdown, noCosts, deleteConfirm,
           toast: { saved, deleted },
           periods: { month, quarter, year, all } }
  TR: Maliyet Merkezi, Yeni Maliyet, Kategori, Tutar, Tarih,
      Bu Ay Toplam, Bu Yıl Toplam, Toplam Kayıt, Kategori Dağılımı, Maliyet bulunamadı,
      Bu maliyeti silmek istediğinizden emin misiniz?
      Kaydedildi, Silindi — Bu Ay, Bu Çeyrek, Bu Yıl, Tüm Zamanlar
"""
  },

  # ────────────────────────────────────────────────────
  {
    "id": "admin_enhanced",
    "name": "Yönetim Paneli (Geliştirilmiş)",
    "has_migration": True,
    "commit_msg": "feat: Yönetim Paneli — audit log + sistem istatistikleri + 3-tab UI",
    "prompt": CTX + """
GÖREV: Mevcut Yönetim Paneli'ni geliştir.

ADIM 1 — backend/migrations/011_audit_log.sql:
  CREATE TABLE audit_log (
    id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID  REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT  NOT NULL CHECK (action IN ('create','update','delete','login','export','view')),
    entity_type TEXT,
    entity_id   UUID,
    details     JSONB DEFAULT '{}',
    ip_address  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_audit_user    ON audit_log(user_id);
  CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
  ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
  CREATE POLICY audit_read ON audit_log FOR SELECT USING (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator')
  );
  CREATE POLICY audit_insert ON audit_log FOR INSERT WITH CHECK (TRUE);

ADIM 2 — backend/src/routes/admin.js'e YENİ endpoint'ler EKLE (mevcut kodlara dokunma):
  GET /admin/stats → {
    users: count, customers: count, opportunities: count,
    offers: count, products: count, files: count (files tablosu yoksa 0 dön try/catch)
  }
  GET /admin/audit-log?page=1&limit=50 →
    SELECT al.*, u.full_name as user_name FROM audit_log al
    LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.created_at DESC LIMIT $1 OFFSET $2

ADIM 3 — frontend/src/pages/YonetimPaneliPage.jsx TAMAMEN YENİDEN YAZ:
  3 Tab sistemi: Kullanıcılar | Sistem İstatistikleri | Audit Log

  Tab "Kullanıcılar":
    Mevcut kullanıcı yönetimi kodunu buraya al (list, add, edit, toggle status, reset password)
    Değiştirme — sadece tab container içine taşı

  Tab "Sistem İstatistikleri":
    api.get('/admin/stats') ile 6 KPI kartı grid
    Users, Customers, Opportunities, Offers, Products, Files
    Her kart: ikon + sayı + etiket — dark tema .card sınıfı

  Tab "Audit Log":
    api.get('/admin/audit-log?page=X') ile tablo
    Sütunlar: Tarih/Saat, Kullanıcı, Aksiyon (badge renkli: create=yeşil, delete=kırmızı, update=mavi, login=gri), Varlık Tipi, Detaylar (kısaltılmış JSON)
    Pagination (50/sayfa, önceki/sonraki butonları)
    Sadece owner/coordinator erişebilir (mevcut auth kontrolü yeterli)

ADIM 4 — i18n TÜM 5 DOSYA — admin section'ı GÜNCELLEŞTİR (override değil, ekle):
  - Her dil dosyasını oku
  - admin.tabs objesine stats ve auditLog anahtarı EKLE (users ve permissions KOR)
  - admin.stats section EKLE: { title, totalUsers, totalCustomers, totalOpportunities, totalOffers, totalProducts, totalFiles }
  - admin.auditLog section EKLE: { title, action, entityType, details, noLogs, actions:{create,update,delete,login,export,view} }
  TR değerleri: Sistem İstatistikleri, Audit Log | Kullanıcılar, Müşteriler, Fırsatlar, Teklifler, Ürünler, Dosyalar
  İstatistikler, Audit Logu, Eylem, Varlık Tipi, Detaylar, Kayıt bulunamadı
  Oluşturma, Güncelleme, Silme, Giriş, Dışa Aktarma, Görüntüleme
"""
  },

  # ────────────────────────────────────────────────────
  {
    "id": "ustabot",
    "name": "UstaBot AI Asistanı",
    "has_migration": False,
    "commit_msg": "feat: UstaBot — Anthropic SDK streaming chat API + full chat UI",
    "prompt": CTX + """
GÖREV: UstaBot AI asistan modülünü uygula.

ADIM 1 — Anthropic Node.js SDK kur:
  docker-compose exec -T backend npm install @anthropic-ai/sdk --save

ADIM 2 — backend/src/routes/ustabot.js oluştur:
  import Anthropic from '@anthropic-ai/sdk';

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const SYSTEM = `Sen GDSales360.ai CRM platformunun AI asistanısın.
Gençdegirmen Makinalari değirmencilik (un, irmik) makineleri üreticisi.
Satış ekibine: CRM kullanımı, müşteri ilişkileri, teklif yazımı, satış stratejisi konularında yardım et.
Kısa, pratik, iş odaklı cevaplar ver. Türkçe konuş.`;

  router.use(authenticate);

  GET /status → { available: !!process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001' }

  POST /chat:
  Body: { messages: [{role:'user'|'assistant', content: string}] }
  - messages array'i max 20 elemana kırp (son 20)
  - ANTHROPIC_API_KEY yoksa: 503 { success: false, error: 'API anahtarı yapılandırılmamış' }
  - SSE ile stream:
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const stream = anthropic.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM,
      messages: messages
    });
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
        res.write(`data: ${JSON.stringify({text: chunk.delta.text})}\\n\\n`);
      }
    }
    res.write('data: [DONE]\\n\\n');
    res.end();
  - Hata: res.write(`data: ${JSON.stringify({error: err.message})}\\n\\n`); res.end();

ADIM 3 — backend/src/index.js güncelle:
  import ustabotRouter from './routes/ustabot.js';
  app.use('/api/v1/ustabot', ustabotRouter);

ADIM 4 — backend/.env dosyasına ANTHROPIC_API_KEY yoksa ekle:
  Önce dosyayı oku, varsa dokunma. Yoksa satır ekle:
  # ANTHROPIC_API_KEY=sk-ant-your-key-here

ADIM 5 — frontend/src/pages/UstaBotPage.jsx oluştur:
  Tam chat arayüzü:
  - Layout: flex flex-col h-full (MainLayout zaten scroll veriyor)
  - Header: "🤖 UstaBot" + model badge (soluk metin) + "Temizle" butonu
  - Mesaj alanı (flex-1, overflow-y-auto, padding):
    * Kullanıcı: sağ hizalı, bg-brand-600/80 text-white, rounded-2xl rounded-br-sm
    * Bot: sol hizalı, bg-dark-700 text-slate-200, rounded-2xl rounded-bl-sm
    * Bot yazıyor: "●●●" pulse animasyonu (3 nokta CSS animation)
    * Zaman damgası küçük ve soluk
  - Input alanı (border-t): textarea (rows=2, resize-none, Shift+Enter yeni satır, Enter gönder)
  - Gönder butonu (Gönder ikonu veya metin), disabled while streaming
  - Streaming: fetch('/api/v1/ustabot/chat', {method:'POST', headers:{Authorization:'Bearer '+token}, body:JSON.stringify({messages})})
    Response SSE: reader = response.body.getReader(); TextDecoder; satır satır parse
    data: {"text":"..."} → mevcut bot mesajına append et (state update)
    data: [DONE] → stream bitti
  - İlk mesajda GET /ustabot/status ile API kontrolü, unavailable ise banner göster
  - localStorage ile mesajları sakla (key: 'gd360-ustabot-messages', max 50 mesaj)
  - Sayfa açılınca mesajları yükle
  - Hoş geldin mesajı (localStorage boşsa): "Merhaba! Ben UstaBot. Satış ve CRM konularında yardımcı olabilirim. Ne sorabilirsiniz?"

ADIM 6 — frontend/src/App.jsx:
  import UstaBotPage from './pages/UstaBotPage.jsx';
  <Route path="ustabot" element={<UstaBotPage />} />  ← placeholder güncelle

ADIM 7 — i18n TÜM 5 DOSYA ustabot section (admin'den önce):
  ustabot: { title, placeholder, send, clear, thinking, error, apiNotConfigured,
             welcomeMessage, you, bot, model }
  TR: UstaBot, Bir şey sorun..., Gönder, Temizle, Düşünüyor..., Bir hata oluştu,
      API anahtarı yapılandırılmamış. Lütfen yöneticinize başvurun.,
      Merhaba! Ben UstaBot..., Sen, UstaBot, Model
"""
  },
]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ANA DÖNGÜ
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def main():
    # --from argument ile belirli bir görevden başla
    start_from = None
    if '--from' in sys.argv:
        idx = sys.argv.index('--from')
        if idx + 1 < len(sys.argv):
            start_from = sys.argv[idx + 1]

    setup()
    ckpt = load_ckpt()

    print(f"\n{W}{C}  GD360 Module Orchestrator v1.0{E}")
    print(f"{C}  {datetime.now().strftime('%Y-%m-%d %H:%M')}  |  claude: {CLAUDE}{E}\n")

    check_docker()
    print_status(TASKS, ckpt)

    skipping = bool(start_from)
    for task in TASKS:
        tid  = task['id']
        name = task['name']

        # --from TASK_ID ile başlatıldıysa önceki görevleri atla
        if skipping:
            if tid == start_from:
                skipping = False
                # Bu görevi checkpoint'ten kaldır (yeniden çalıştırmak için)
                ckpt['completed'] = [c for c in ckpt.get('completed', []) if c != tid]
            else:
                log(f"[SKIP] {name}", B)
                continue

        if tid in ckpt.get('completed', []):
            log(f"[SKIP] {name} -- zaten tamamlandi", G)
            continue

        log(f"\n{'-'*52}", B)
        log(f" >> [{ts()}] BASLIYOR: {name}", W)
        log(f"{'-'*52}", B)

        success = False
        for attempt in range(1, 4):
            if attempt > 1:
                log(f"\n  ~> Yeniden deneniyor (attempt {attempt}/3)...", Y)
                time.sleep(8)

            ok, _output = run_claude(task['prompt'], tid, attempt)

            if not ok:
                log(f"  [!] Claude basarisiz (attempt {attempt})", R)
                continue

            log(f"  [+] Claude tamamlandi", G)

            if task.get('has_migration'):
                time.sleep(3)  # container dosyaları yazmasını bekle
                if not run_migration():
                    log(f"  [!] Migration basarisiz -- yeniden deneniyor", R)
                    continue

            if git_commit(task['commit_msg']):
                ckpt.setdefault('completed', []).append(tid)
                ckpt[f'{tid}_completed_at'] = datetime.now().isoformat()
                save_ckpt(ckpt)
                log(f"\n  *** {W}{name} TAMAMLANDI!{E}", G)
                success = True
                break
            else:
                log(f"  [!] Git commit basarisiz (attempt {attempt})", R)

        if not success:
            log(f"\n{R}[!!] {name} 3 denemede basarisiz oldu.{E}", R)
            log(f"  Devam etmek için: python orchestrator.py --from {tid}", Y)
            sys.exit(1)

        # Modüller arası kısa bekleme
        time.sleep(5)

    print_status(TASKS, ckpt)
    log(f"{G}{W}  [DONE] Tum moduller basariyla tamamlandi!{E}", G)


if __name__ == '__main__':
    main()
