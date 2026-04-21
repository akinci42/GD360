#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GD360 Module Orchestrator v4 — Claude CLI (--no-session-persistence)
Anthropic SDK YOK. claude CLI subprocess + --no-session-persistence flag.

Kullanım:
  python orchestrator.py              -- kalan görevleri sırayla çalıştır
  python orchestrator.py --from ID    -- belirli görevden başla (öncekileri sıfırla)
  python orchestrator.py --test       -- basit test görevi
  python orchestrator.py --status     -- sadece durum göster
"""

import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# Windows UTF-8 fix
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# ── ANSI renkler ──────────────────────────────────────────────────────────────
G = '\033[92m'; R = '\033[91m'; Y = '\033[93m'
B = '\033[94m'; C = '\033[96m'; W = '\033[1m';  E = '\033[0m'

# ── Yollar ────────────────────────────────────────────────────────────────────
PROJECT_DIR = Path(__file__).parent.resolve()
AGENT_DIR   = PROJECT_DIR / '.gd360-agent'
CKPT_FILE   = AGENT_DIR  / 'checkpoint.json'
LOGS_DIR    = AGENT_DIR  / 'logs'

# ── Bash executable (Git Bash öncelikli, fallback sistem bash) ────────────────
def find_bash():
    candidates = [
        r'C:\Program Files\Git\usr\bin\bash.exe',
        r'C:\Program Files (x86)\Git\usr\bin\bash.exe',
        shutil.which('bash') or '',
    ]
    for c in candidates:
        if c and Path(c).exists():
            return c
    raise FileNotFoundError("bash bulunamadı — Git for Windows kurulu olmalı")

# ── Helpers ───────────────────────────────────────────────────────────────────
def log(msg, color=E):
    print(f"{color}{msg}{E}", flush=True)

def ts():
    return datetime.now().strftime('%H:%M:%S')

def setup():
    AGENT_DIR.mkdir(exist_ok=True)
    LOGS_DIR.mkdir(exist_ok=True)
    gi = PROJECT_DIR / '.gitignore'
    txt = gi.read_text(encoding='utf-8') if gi.exists() else ''
    if '.gd360-agent' not in txt:
        with open(gi, 'a', encoding='utf-8') as f:
            f.write('\n.gd360-agent/\n')

def load_ckpt():
    if CKPT_FILE.exists():
        return json.loads(CKPT_FILE.read_text(encoding='utf-8'))
    return {'completed': [], 'started_at': datetime.now().isoformat()}

def save_ckpt(ckpt):
    CKPT_FILE.write_text(json.dumps(ckpt, indent=2, ensure_ascii=False), encoding='utf-8')

# ── Git helpers ────────────────────────────────────────────────────────────────
def git_changed_files():
    r = subprocess.run(['git', 'status', '--short'],
                       cwd=PROJECT_DIR, capture_output=True,
                       text=True, encoding='utf-8')
    EXCLUDE = ['.gd360-agent', 'orchestrator.py', '__pycache__']
    result = []
    for raw in r.stdout.strip().splitlines():
        stripped = raw.strip()
        if not stripped:
            continue
        parts = stripped.split()
        path = parts[-1].strip('"').replace('\\', '/')
        if any(ex in path for ex in EXCLUDE):
            continue
        result.append(stripped)
    return result

def git_commit(msg):
    subprocess.run(['git', 'add', '-A'], cwd=PROJECT_DIR)
    full = f"{msg}\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
    r = subprocess.run(['git', 'commit', '-m', full],
                       cwd=PROJECT_DIR, capture_output=True,
                       text=True, encoding='utf-8')
    if r.returncode == 0:
        log(f"  [+] git commit OK", G); return True
    combined = (r.stdout + r.stderr).lower()
    if 'nothing to commit' in combined or 'no changes' in combined:
        log(f"  ~ commit edilecek değişiklik yok", Y); return True
    log(f"  [!] git commit hatası: {r.stderr.strip()[-200:]}", R)
    return False

def run_migration():
    log(f"  [{ts()}] Migration çalıştırılıyor...", Y)
    r = subprocess.run(
        ['docker-compose', 'exec', '-T', 'backend', 'npm', 'run', 'migrate'],
        cwd=PROJECT_DIR, capture_output=True,
        text=True, encoding='utf-8', timeout=120
    )
    if r.returncode != 0:
        log(f"  [!] Migration hatası: {r.stderr.strip()[-300:]}", R)
        return False
    log(f"  [+] Migration başarılı", G)
    return True

def check_docker():
    r = subprocess.run(['docker-compose', 'ps', 'backend'],
                       cwd=PROJECT_DIR, capture_output=True,
                       text=True, timeout=15)
    if r.returncode != 0 or 'Up' not in r.stdout:
        log("  [!] Backend container çalışmıyor — docker-compose up -d önerilir", Y)

def print_status(tasks, ckpt):
    done = set(ckpt.get('completed', []))
    print(f"\n{W}{'='*56}{E}")
    print(f"{W}  GD360 Orchestrator v4 (CLI)  |  {datetime.now():%Y-%m-%d %H:%M}{E}")
    print(f"{W}{'='*56}{E}")
    for t in tasks:
        icon = f"{G}[OK]{E}" if t['id'] in done else f"{Y}[ ]{E}"
        at = ckpt.get(f"{t['id']}_completed_at", '')
        when = f"  {at[:16]}" if at else ''
        print(f"  {icon}  {t['name']}{when}")
    rem = sum(1 for t in tasks if t['id'] not in done)
    print(f"\n  Toplam: {len(tasks)}  Tamamlanan: {len(done)}  Kalan: {rem}")
    print(f"{W}{'='*56}{E}\n")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# GD360 SYSTEM CONTEXT (prompt'a eklenir)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GD360_CONTEXT = """
SEN GD360 PROJESİNİN GELİŞTİRİCİSİSİN. C:\\Projects\\GD360 dizininde çalışıyorsun.

STACK:
- Backend: Node.js 20 + Express 5 (ESM: import/export), PostgreSQL 16 + RLS, Redis 7
- Frontend: React 18 + Vite + Tailwind CSS v3 dark tema
- Docker Compose ortamı

KRİTİK BACKEND PATTERN (her route dosyası bu şablonu takip eder):
  import { Router } from 'express';
  import { authenticate } from '../middleware/auth.js';
  import { getRlsClient } from '../db/rls.js';
  const router = Router();
  router.use(authenticate);
  router.get('/', async (req, res, next) => {
    const client = await getRlsClient(req.user);
    try {
      const { rows } = await client.query('SELECT ...', [...]);
      res.json({ success: true, data: rows });
    } catch (err) { next(err); } finally { client.release(); }
  });
  export default router;

KRİTİK FRONTEND PATTERN:
  import { useState, useEffect } from 'react';
  import { useTranslation } from 'react-i18next';
  import { useAuthStore } from '../store/authStore.js';
  import api from '../utils/api.js';

TAILWIND: bg-dark-900/800/700, border-dark-700, text-slate-100/200/400/500, brand-600
CSS utils: .card, .input, .form-label, .btn-primary, .btn-secondary

RLS SQL:
  current_setting('app.user_role', TRUE) IN ('owner','coordinator')
  current_setting('app.user_id', TRUE)

GÖREV TAMAMLANINCA: "GÖREV TAMAMLANDI" yaz ve dur.
"""


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CLI ÇALIŞTIRICISI
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def run_with_cli(task_id, prompt, attempt=1):
    """Git Bash üzerinden claude --no-session-persistence stdin pipe ile çalıştır."""
    log_file = LOGS_DIR / f"{task_id}_a{attempt}_{datetime.now().strftime('%H%M%S')}.log"
    log(f"  [{ts()}] CLI başlıyor (deneme {attempt})... log → {log_file.name}", C)

    full_prompt = GD360_CONTEXT.strip() + "\n\n" + "=" * 60 + "\n\n" + prompt

    with open(log_file, 'w', encoding='utf-8', errors='replace') as f:
        f.write(f"TASK: {task_id}  ATTEMPT: {attempt}\n")
        f.write(f"TIME: {datetime.now().isoformat()}\n")
        f.write("=" * 60 + "\n\n")
        f.write(f"PROMPT (ilk 500 kr):\n{prompt[:500]}\n\n")
        f.write("=" * 60 + "\n\n")

    try:
        bash = find_bash()
    except FileNotFoundError as e:
        log(f"  [!] {e}", R)
        sys.exit(1)

    bash_cmd = "claude --dangerously-skip-permissions --no-session-persistence --print"

    try:
        proc = subprocess.Popen(
            [bash, '-c', bash_cmd],
            cwd=str(PROJECT_DIR),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

        stdout_bytes, _ = proc.communicate(
            input=full_prompt.encode('utf-8', errors='replace'),
            timeout=600,
        )
        output = stdout_bytes.decode('utf-8', errors='replace')
        rc = proc.returncode

        with open(log_file, 'a', encoding='utf-8', errors='replace') as f:
            f.write(f"OUTPUT:\n{output}\n\n[exit code: {rc}]\n")

        # Son 30 satırı kullanıcıya göster
        lines = output.strip().splitlines()
        for line in lines[-30:]:
            display = line[:120]
            if display:
                log(f"  {display}", C)

        if rc != 0:
            log(f"  [!] claude exit code: {rc}", R)
            return False

        return True

    except subprocess.TimeoutExpired:
        proc.kill()
        log(f"  [!] Zaman aşımı (600s)", R)
        with open(log_file, 'a', encoding='utf-8', errors='replace') as f:
            f.write("HATA: Zaman aşımı (600s)\n")
        return False
    except Exception as e:
        log(f"  [!] Hata: {type(e).__name__}: {e}", R)
        return False


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# GÖREV ÇALIŞTIRICISI
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def run_task(task, ckpt):
    tid  = task['id']
    name = task['name']

    log(f"\n{'-'*56}", B)
    log(f" >> [{ts()}] BAŞLIYOR: {name}", W)
    log(f"{'-'*56}", B)

    prompt = task['prompt']

    for attempt in range(1, 4):
        if attempt > 1:
            log(f"\n  ~> Yeniden deneniyor (deneme {attempt}/3)...", Y)
            time.sleep(8)
            # Dosya değişikliği olmadığında ek talimat ekle
            prompt = task['prompt'] + (
                f"\n\nÖNEMLİ (deneme {attempt}): Önceki denemede dosya değişikliği tespit edilmedi. "
                "Bahsettiğin dosyaları GERÇEKTEN oluştur/düzenle. "
                "Write veya Edit araçlarını kullanmadan görev tamamlanmış sayılmaz."
            )

        ok = run_with_cli(tid, prompt, attempt)

        if not ok:
            log(f"  [!] CLI çağrısı başarısız (deneme {attempt})", R)
            continue

        changes = git_changed_files()
        if not changes:
            log(f"  [!] Dosya değişikliği tespit edilmedi (deneme {attempt})", R)
            continue

        log(f"  [+] {len(changes)} dosya değişti:", G)
        for f in changes[:10]:
            log(f"      {f}", C)
        if len(changes) > 10:
            log(f"      ... ve {len(changes)-10} daha", C)

        if task.get('has_migration'):
            time.sleep(2)
            if not run_migration():
                log(f"  [!] Migration başarısız (deneme {attempt})", R)
                continue

        if git_commit(task['commit_msg']):
            ckpt.setdefault('completed', []).append(tid)
            ckpt[f'{tid}_completed_at'] = datetime.now().isoformat()
            save_ckpt(ckpt)
            log(f"\n  *** {W}{name} TAMAMLANDI!{E}", G)
            return True
        else:
            log(f"  [!] git commit başarısız (deneme {attempt})", R)

    log(f"\n{R}[!!] {name} 3 denemede başarısız.{E}", R)
    log(f"  Tekrar: python orchestrator.py --from {tid}", Y)
    return False


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST GÖREVİ
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEST_TASK = {
    "id": "cli_test",
    "name": "CLI Test Görevi",
    "has_migration": False,
    "commit_msg": "test: CLI orchestrator dogrulama",
    "prompt": f"""Asagidaki gorevleri sirayla yap:

1. backend/src/routes/ dizinini listele (ls veya dir komutu)
2. backend/migrations/ dizinini listele
3. backend/TEST_ORCHESTRATOR.md dosyasini olustur:
   # Orchestrator CLI Test — BASARILI
   Tarih: {datetime.now().strftime('%Y-%m-%d %H:%M')}
   Flag: --no-session-persistence

   Adim 1 ciktisi (routes/):
   [buraya listele]

   Adim 2 ciktisi (migrations/):
   [buraya listele]

   ## Sonuc
   claude --no-session-persistence -p calisti.
   Dosya Write araci ile olusturuldu.
   CLI orchestrator calisiyor.

4. Olusturdugun dosyayi oku ve icerigi dogrula.

Bitince "GOREV TAMAMLANDI" yaz.""",
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# GÖREVLER
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASKS = [
  {
    "id": "files",
    "name": "Dosya Merkezi",
    "has_migration": True,
    "commit_msg": "feat: Dosya Merkezi — multer upload API + file browser UI",
    "prompt": """Dosya Merkezi modülünü uygula. Mevcut dosyaları önce oku.

ADIM 1 — backend/migrations/008_files.sql oluştur:
  CREATE TABLE files (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_name TEXT NOT NULL,
    stored_name   TEXT NOT NULL,
    mime_type     TEXT,
    size_bytes    BIGINT DEFAULT 0,
    customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    offer_id      UUID REFERENCES offers(id) ON DELETE SET NULL,
    uploaded_by   UUID NOT NULL REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_files_customer  ON files(customer_id);
  CREATE INDEX idx_files_uploader  ON files(uploaded_by);
  ALTER TABLE files ENABLE ROW LEVEL SECURITY;
  CREATE POLICY files_select ON files FOR SELECT USING (
    current_setting('app.user_role',TRUE) IN ('owner','coordinator','viewer')
    OR uploaded_by::TEXT = current_setting('app.user_id',TRUE)
  );
  CREATE POLICY files_insert ON files FOR INSERT WITH CHECK (
    current_setting('app.user_role',TRUE) IN ('owner','coordinator','sales')
  );
  CREATE POLICY files_delete ON files FOR DELETE USING (
    current_setting('app.user_role',TRUE) IN ('owner','coordinator')
    OR uploaded_by::TEXT = current_setting('app.user_id',TRUE)
  );

ADIM 2 — multer kur:
  docker-compose exec -T backend npm install multer --save

ADIM 3 — backend/src/routes/files.js oluştur (ESM syntax):
  GET /          → dosya listesi (query: customer_id?)
  POST /upload   → multer.single('file') + DB insert
  GET /:id/download → res.download()
  DELETE /:id    → DB sil + fs.unlink

ADIM 4 — backend/src/index.js güncelle (önce oku, sonra ekle):
  import filesRouter + app.use('/api/v1/files', filesRouter)

ADIM 5 — frontend/src/pages/FilesPage.jsx oluştur — dosya listesi, yükle butonu, sil

ADIM 6 — frontend/src/App.jsx güncelle:
  import FilesPage → <Route path="dosyalar" element={<FilesPage />} />

ADIM 7 — i18n TR/EN/RU/AR/FR'ye files section ekle (admin bloğundan önce)

Bitince "GÖREV TAMAMLANDI" yaz.""",
  },

  {
    "id": "performance",
    "name": "Performans & Prim",
    "has_migration": False,
    "commit_msg": "feat: Performans & Prim — reports API + leaderboard UI",
    "prompt": """Performans & Prim modülünü uygula. Migration gerekmez.

ADIM 1 — backend/src/routes/reports.js oluştur:
  GET /performance?period=month|quarter|year
    Her satışçı için: won_value, won_count, lost_count, win_rate, activities_count
    Period: month=30gün, quarter=90gün, year=365gün
    owner/coordinator: tüm; sales: sadece kendisi
  GET /leaderboard?period=month
    won_value DESC sırala, rank ekle

ADIM 2 — backend/src/index.js → reportsRouter ekle (önce oku, sonra ekle)

ADIM 3 — frontend/src/pages/PerformansPage.jsx:
  3 period tab (Bu Ay/Çeyrek/Yıl), leaderboard tablo,
  1.=🥇 2.=🥈 3.=🥉, win rate bar, kendi satırı highlighted

ADIM 4 — App.jsx → PerformansPage route

ADIM 5 — i18n performance section (5 dil)

Bitince "GÖREV TAMAMLANDI" yaz.""",
  },

  {
    "id": "notifications",
    "name": "Bildirimler",
    "has_migration": True,
    "commit_msg": "feat: Bildirimler — notification system + badge + UI",
    "prompt": """Bildirim sistemi uygula.

ADIM 1 — backend/migrations/009_notifications.sql:
  CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('opportunity_stage','followup_due','offer_sent','offer_accepted','system')),
    title TEXT NOT NULL, body TEXT,
    entity_type TEXT, entity_id UUID,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_notif_user ON notifications(user_id);
  CREATE INDEX idx_notif_unread ON notifications(user_id,is_read) WHERE is_read=FALSE;
  ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
  CREATE POLICY notif_own ON notifications FOR ALL
    USING(user_id::TEXT=current_setting('app.user_id',TRUE))
    WITH CHECK(user_id::TEXT=current_setting('app.user_id',TRUE));

ADIM 2 — backend/src/routes/notifications.js:
  GET /             → son 50 bildirim
  GET /unread-count → {count:N}
  POST /            → oluştur (owner/coordinator)
  PATCH /:id/read   → okundu
  PATCH /read-all   → hepsini okundu
  DELETE /:id       → sil

ADIM 3 — index.js → notificationsRouter ekle

ADIM 4 — frontend/src/layouts/MainLayout.jsx:
  iletisim nav item'ına unread badge ekle (kırmızı, 60sn polling)

ADIM 5 — frontend/src/pages/IletisimBildirimlerPage.jsx yeniden yaz:
  Gerçek API verisi, "Tümünü Okundu" butonu, tip ikonları

ADIM 6 — i18n notifications section (5 dil)

Bitince "GÖREV TAMAMLANDI" yaz.""",
  },

  {
    "id": "costs",
    "name": "Maliyet Merkezi",
    "has_migration": True,
    "commit_msg": "feat: Maliyet Merkezi — cost tracking + CRUD",
    "prompt": """Maliyet Merkezi modülünü uygula.

ADIM 1 — backend/migrations/010_costs.sql:
  cost_categories tablosu (name, color) + 5 seed
  costs tablosu (category_id, title, amount NUMERIC(15,2), currency, cost_date DATE,
    customer_id, notes, created_by, timestamps)
  RLS: owner/coordinator tam erişim, sales: kendi

ADIM 2 — backend/src/routes/costs.js:
  GET /categories → kategori listesi
  GET / → liste + summary{grand_total, by_category}
  POST / → yeni
  PATCH /:id → güncelle
  DELETE /:id → sil

ADIM 3 — index.js → costsRouter

ADIM 4 — frontend/src/pages/MaliyetPage.jsx:
  KPI kartlar, kategori breakdown, tarih filtre, tablo, modal form

ADIM 5 — App.jsx → MaliyetPage

ADIM 6 — i18n costs (5 dil)

Bitince "GÖREV TAMAMLANDI" yaz.""",
  },

  {
    "id": "admin_enhanced",
    "name": "Yönetim Paneli (Gelişmiş)",
    "has_migration": True,
    "commit_msg": "feat: Yönetim Paneli — audit log + istatistikler + 3-tab UI",
    "prompt": """Yönetim Paneli'ni genişlet.

ADIM 1 — backend/migrations/011_audit_log.sql:
  audit_log (user_id, action CHECK IN create/update/delete/login,
    entity_type, entity_id, details JSONB, ip_address, created_at)
  RLS: owner/coordinator okur, herkes yazar

ADIM 2 — backend/src/routes/admin.js'e EKLE (mevcut koda dokunma):
  GET /stats → {users,customers,opportunities,offers,products}
  GET /audit-log?page=1&limit=50 → LOG JOIN users ORDER BY created_at DESC

ADIM 3 — frontend/src/pages/YonetimPaneliPage.jsx:
  3. tab "Sistem İstatistikleri" ekle → /admin/stats 6 KPI kart
  4. tab "Audit Log" ekle → /admin/audit-log tablo + pagination
  Mevcut Kullanıcılar ve Yetki Matrisi tabları KOR

ADIM 4 — i18n admin section'ına tabs.stats + tabs.auditLog ekle (5 dil)

Bitince "GÖREV TAMAMLANDI" yaz.""",
  },

  {
    "id": "ustabot",
    "name": "UstaBot AI Asistanı",
    "has_migration": False,
    "commit_msg": "feat: UstaBot — Anthropic SSE streaming + chat UI",
    "prompt": """UstaBot AI asistan modülünü uygula.

ADIM 1 — @anthropic-ai/sdk kur:
  docker-compose exec -T backend npm install @anthropic-ai/sdk --save

ADIM 2 — backend/src/routes/ustabot.js:
  GET /status → {available:!!process.env.ANTHROPIC_API_KEY}
  POST /chat body:{messages:[{role,content}]}
  SSE streaming: anthropic.messages.stream({model:'claude-haiku-4-5-20251001',max_tokens:1024,...})
  chunk.type==='content_block_delta' → res.write('data: '+JSON.stringify({text}))
  ANTHROPIC_API_KEY yoksa 503 dön

ADIM 3 — index.js → ustabotRouter

ADIM 4 — frontend/src/pages/UstaBotPage.jsx:
  Tam chat UI, SSE streaming fetch, localStorage mesaj geçmişi,
  kullanıcı sağ/bot sol mesaj balonları, typing indicator, gönder butonu

ADIM 5 — App.jsx → UstaBotPage

ADIM 6 — i18n ustabot section (5 dil)

Bitince "GÖREV TAMAMLANDI" yaz.""",
  },
]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# MAIN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def main():
    args = sys.argv[1:]
    test_mode   = '--test'   in args
    status_mode = '--status' in args
    start_from  = None
    if '--from' in args:
        idx = args.index('--from')
        if idx + 1 < len(args):
            start_from = args[idx + 1]

    setup()
    ckpt = load_ckpt()

    print(f"\n{W}{C}  GD360 Orchestrator v4 — Claude CLI{E}")
    print(f"{C}  {datetime.now():%Y-%m-%d %H:%M}  |  flag: --no-session-persistence{E}\n")

    if status_mode:
        print_status(TASKS, ckpt)
        return

    check_docker()

    if test_mode:
        log(f"{Y}[TEST] CLI + dosya oluşturma doğrulaması...{E}", Y)
        test_file = PROJECT_DIR / 'backend' / 'TEST_ORCHESTRATOR.md'
        if test_file.exists():
            test_file.unlink()

        task_copy = dict(TEST_TASK)
        ok = run_task(task_copy, {})

        if ok and test_file.exists():
            content = test_file.read_text(encoding='utf-8')
            log(f"\n{G}{W}  [TEST GEÇTİ] Dosya oluşturuldu!{E}", G)
            log(f"  İçerik önizleme:\n{content[:300]}", C)
        elif ok:
            log(f"\n{R}  [TEST BAŞARISIZ] Başarılı dedi ama dosya yok.{E}", R)
        else:
            log(f"\n{R}  [TEST BAŞARISIZ] Görev tamamlanamadı.{E}", R)

        # Test dosyasını commit etme
        subprocess.run(['git', 'checkout', '--', 'backend/TEST_ORCHESTRATOR.md'],
                       cwd=PROJECT_DIR, capture_output=True)
        if test_file.exists():
            test_file.unlink(missing_ok=True)
        return

    print_status(TASKS, ckpt)

    skipping = bool(start_from)
    for task in TASKS:
        tid = task['id']

        if skipping:
            if tid == start_from:
                skipping = False
                ckpt['completed'] = [c for c in ckpt.get('completed', []) if c != tid]
                save_ckpt(ckpt)
            else:
                log(f"[SKIP] {task['name']}", B)
                continue

        if tid in ckpt.get('completed', []):
            log(f"[SKIP] {task['name']} — zaten tamamlandı", G)
            continue

        if not run_task(task, ckpt):
            sys.exit(1)

        time.sleep(5)

    print_status(TASKS, ckpt)
    log(f"{G}{W}  [DONE] Tüm modüller tamamlandı!{E}", G)


if __name__ == '__main__':
    main()
