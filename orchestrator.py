#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GD360 Module Orchestrator v2
--print KALDIRILDI: claude -p <prompt> gercekten araclari kullanir ve dosya yazar.
Kullanim:
  python orchestrator.py              -- kalan tum gorevleri calistir
  python orchestrator.py --from ID   -- belirli gorevden basla (oncekini sifirla)
  python orchestrator.py --test      -- basit test gorevi ile dogrula
  python orchestrator.py --status    -- sadece durum goster, calistirma
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
G = '\033[92m'
R = '\033[91m'
Y = '\033[93m'
B = '\033[94m'
C = '\033[96m'
W = '\033[1m'
E = '\033[0m'

# ── Yollar ────────────────────────────────────────────────────────────────────
PROJECT_DIR = Path(__file__).parent.resolve()
AGENT_DIR   = PROJECT_DIR / '.gd360-agent'
CKPT_FILE   = AGENT_DIR  / 'checkpoint.json'
LOGS_DIR    = AGENT_DIR  / 'logs'

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
    return 'claude'

CLAUDE = find_claude()

# ── Git helpers ───────────────────────────────────────────────────────────────
def git_changed_files():
    """Returns list of changed/new files (excludes .gd360-agent and orchestrator.py)."""
    r = subprocess.run(
        ['git', 'status', '--short'],
        cwd=PROJECT_DIR, capture_output=True, text=True, encoding='utf-8'
    )
    EXCLUDE = ['.gd360-agent', 'orchestrator.py']
    lines = []
    for raw in r.stdout.strip().splitlines():
        # git status --short: "XY filename" — XY = 1-2 status chars, then space(s), then path
        # Robust parse: split on whitespace and take last part as path
        stripped = raw.strip()
        if not stripped:
            continue
        parts = stripped.split()
        # path may be last token; handle renamed "old -> new" format too
        path = parts[-1].strip('"').replace('\\', '/')
        if any(ex in path for ex in EXCLUDE):
            continue
        lines.append(stripped)
    return lines

def git_has_changes():
    return len(git_changed_files()) > 0

def git_commit(msg):
    subprocess.run(['git', 'add', '-A'], cwd=PROJECT_DIR)
    full_msg = f"{msg}\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
    r = subprocess.run(
        ['git', 'commit', '-m', full_msg],
        cwd=PROJECT_DIR, capture_output=True, text=True, encoding='utf-8'
    )
    if r.returncode == 0:
        log(f"  [+] Git commit OK", G)
        return True
    combined = (r.stdout + r.stderr).lower()
    if 'nothing to commit' in combined or 'no changes' in combined:
        log(f"  ~ Commit edilecek degisiklik yok (dosyalar zaten mevcut)", Y)
        return True
    log(f"  [!] Git commit hatasi: {r.stderr.strip()[-200:]}", R)
    return False

# ── Migration ─────────────────────────────────────────────────────────────────
def run_migration():
    log(f"  [{ts()}] Migration calistiriliyor...", Y)
    r = subprocess.run(
        ['docker-compose', 'exec', '-T', 'backend', 'npm', 'run', 'migrate'],
        cwd=PROJECT_DIR, capture_output=True, text=True, encoding='utf-8', timeout=120
    )
    if r.returncode != 0:
        log(f"  [!] Migration hatasi: {r.stderr.strip()[-300:]}", R)
        return False
    log(f"  [+] Migration basarili", G)
    return True

# ── Claude runner ──────────────────────────────────────────────────────────────
def run_claude(prompt, task_id, attempt):
    """
    --print OLMADAN calistir: claude -p <prompt>
    Bu modda Claude arac kullanir (Write/Edit/Bash) ve gercekten dosya yazar.
    --print ile calistirildiginda sadece metin ciktisi verir, dosya yazmaz.
    """
    log_file = LOGS_DIR / f"{task_id}_a{attempt}_{datetime.now().strftime('%H%M%S')}.log"
    log(f"  [{ts()}] Claude calistirilıyor (deneme {attempt}/3)...", C)
    log(f"  Komut: {CLAUDE} --dangerously-skip-permissions -p <prompt>  [--print YOK]", C)
    log(f"  Log: {log_file.name}", C)

    try:
        # KRITIK: --print FLAG'I YOK
        # -p ile prompt gecilir, araclari kullanarak gercekten dosya yazar
        # stdin=DEVNULL: TTY beklemesin, hemen calissın
        with open(log_file, 'w', encoding='utf-8', errors='replace') as lf:
            result = subprocess.run(
                [CLAUDE, '--dangerously-skip-permissions', '-p', prompt],
                cwd=PROJECT_DIR,
                stdout=lf,
                stderr=lf,
                stdin=subprocess.DEVNULL,
                timeout=900
            )
    except subprocess.TimeoutExpired:
        log(f"  [!] Zaman asimi (900s)", R)
        return False, "TIMEOUT"
    except FileNotFoundError:
        log(f"  [!] Claude bulunamadi: {CLAUDE}", R)
        return False, "NOT_FOUND"

    output = ""
    if log_file.exists():
        output = log_file.read_text(encoding='utf-8', errors='replace')

    ok = result.returncode == 0

    if not ok:
        tail = output.strip()[-800:]
        log(f"  [!] Hata kodu: {result.returncode}", R)
        if tail:
            log(f"  Son cikti:\n{tail}", R)

    return ok, output

# ── Docker check ──────────────────────────────────────────────────────────────
def check_docker():
    r = subprocess.run(
        ['docker-compose', 'ps', 'backend'],
        cwd=PROJECT_DIR, capture_output=True, text=True, timeout=15
    )
    if r.returncode != 0 or 'Up' not in r.stdout:
        log("  [!] Backend container calısmiyor -- 'docker-compose up -d' onerilir", Y)

# ── Status printer ────────────────────────────────────────────────────────────
def print_status(tasks, ckpt):
    done = set(ckpt.get('completed', []))
    print(f"\n{W}{'='*54}{E}")
    print(f"{W}  GD360 Orchestrator v2 -- Modul Durumu{E}")
    print(f"{W}{'='*54}{E}")
    for t in tasks:
        icon = f"{G}[OK]{E}" if t['id'] in done else f"{Y}[ ]{E}"
        at = ckpt.get(f"{t['id']}_completed_at", '')
        when = f"  {at[:16]}" if at else ''
        print(f"  {icon}  {t['name']}{when}")
    rem = sum(1 for t in tasks if t['id'] not in done)
    print(f"\n  Toplam: {len(tasks)}  Tamamlanan: {len(done)}  Kalan: {rem}")
    print(f"{W}{'='*54}{E}\n")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PROJE BAGLAMLARI
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CTX = r"""Sen GD360 proje gelistiricisisin. Su an C:\Projects\GD360 dizininde calisiyorsun.

STACK:
- Backend: Node.js 20, Express 5 (ESM syntax: import/export), PostgreSQL 16 + RLS, Redis 7
- Frontend: React 18, Vite, Tailwind CSS v3 (dark tema)
- Docker Compose ile calistirilıyor

KRITIK BACKEND PATTERN:
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

KRITIK FRONTEND PATTERN:
  import { useState, useEffect } from 'react';
  import { useTranslation } from 'react-i18next';
  import { useAuthStore } from '../store/authStore.js';
  import api from '../utils/api.js';  // axios, Bearer token otomatiK

TAILWIND DARK TEMA: bg-dark-900, bg-dark-800, bg-dark-700, border-dark-700,
  text-slate-100/200/400/500, brand-600 (accent)
CSS UTILITIES (index.css'de): .card, .input, .form-label, .btn-primary, .btn-secondary

RLS SQL PATTERN:
  current_setting('app.user_role', TRUE) IN ('owner','coordinator')
  current_setting('app.user_id', TRUE)  -- UUID olarak karsilastir

MEVCUT MIGRASYONLAR: 001-011 (tamamlandi)
MEVCUT ROUTES: auth, customers, opportunities, followups, admin, dashboard,
               offers, products, configurations, files, reports, notifications, costs, ustabot

DOSYA DEGISTIRIRKEN:
  1. Once Read tool ile dosyayi OKU
  2. Sonra Edit veya Write ile degistir
  3. Yeni dosya icin Write, mevcut dosyada kucuk degisiklik icin Edit kullan
"""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST GOREVI
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEST_TASK = {
    "id": "orchestrator_test",
    "name": "Orchestrator Dogrulama Testi",
    "has_migration": False,
    "commit_msg": "test: orchestrator arac kullanimi dogrulama",
    "prompt": CTX + """
GOREV: Basit bir test gorevi. Asagidaki adımlari sırayla yap:

ADIM 1 — Bash tool ile rota dosyalarini listele:
  ls backend/src/routes/

ADIM 2 — Bash tool ile migration dosyalarini listele:
  ls backend/migrations/

ADIM 3 — Write tool ile backend/TEST_ORCHESTRATOR.md dosyasini olustur.
  Icerik tam olarak su olsun (adim 1 ve 2 ciktilarini ekle):

  # Orchestrator Test - BASARILI

  Tarih: """ + datetime.now().strftime('%Y-%m-%d %H:%M') + """

  Bu dosya orchestrator'un --print OLMADAN dogru calistigini kanitlar.
  Claude bu dosyayi Write araciyla olusturdu.

  ## backend/src/routes/ icindeki dosyalar
  [adim 1 ciktisini buraya yaz]

  ## backend/migrations/ icindeki dosyalar
  [adim 2 ciktisini buraya yaz]

  ## Sonuc
  Orchestrator v2: CALISIYOR
  Claude arac kullandi ve bu dosyayi yazdi.

ADIM 4 — Basarili oldugunu dogrula: Read tool ile backend/TEST_ORCHESTRATOR.md dosyasini oku.
"""
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ANA GOREVLER (gelecekteki moduller icin)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASKS = [

  # Tum moduller manuel olarak tamamlandi (1311842 commit).
  # Bu liste gelecekteki moduller icin ornek olarak bırakıldı.

  {
    "id": "files",
    "name": "Dosya Merkezi",
    "has_migration": True,
    "commit_msg": "feat: Dosya Merkezi -- multer upload API + file browser UI",
    "prompt": CTX + """
GOREV: Dosya Merkezi modülünü uygula.
[Bu gorev zaten tamamlandi -- checkpoint'e bakiniz]
"""
  },

  {
    "id": "performance",
    "name": "Performans & Prim",
    "has_migration": False,
    "commit_msg": "feat: Performans & Prim -- aggregate reports + leaderboard UI",
    "prompt": CTX + """
GOREV: Performans & Prim modülünü uygula.
[Bu gorev zaten tamamlandi -- checkpoint'e bakiniz]
"""
  },

  {
    "id": "notifications",
    "name": "Bildirimler",
    "has_migration": True,
    "commit_msg": "feat: Bildirimler -- notification system + badge + UI",
    "prompt": CTX + """
GOREV: Bildirim sistemini uygula.
[Bu gorev zaten tamamlandi -- checkpoint'e bakiniz]
"""
  },

  {
    "id": "costs",
    "name": "Maliyet Merkezi",
    "has_migration": True,
    "commit_msg": "feat: Maliyet Merkezi -- cost tracking + CRUD API + UI",
    "prompt": CTX + """
GOREV: Maliyet Merkezi modülünü uygula.
[Bu gorev zaten tamamlandi -- checkpoint'e bakiniz]
"""
  },

  {
    "id": "admin_enhanced",
    "name": "Yonetim Paneli (Gelistirilmis)",
    "has_migration": True,
    "commit_msg": "feat: Yonetim Paneli -- audit log + sistem istatistikleri + 3-tab UI",
    "prompt": CTX + """
GOREV: Yonetim Paneli'ni gelistir.
[Bu gorev zaten tamamlandi -- checkpoint'e bakiniz]
"""
  },

  {
    "id": "ustabot",
    "name": "UstaBot AI Asistani",
    "has_migration": False,
    "commit_msg": "feat: UstaBot -- Anthropic SDK streaming chat + UI",
    "prompt": CTX + """
GOREV: UstaBot AI asistan modülünü uygula.
[Bu gorev zaten tamamlandi -- checkpoint'e bakiniz]
"""
  },
]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# GOREV CALISTIRICI
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def run_task(task, ckpt):
    """Tek bir gorevi calistirir. Basarı durumunu (bool) doner."""
    tid  = task['id']
    name = task['name']

    log(f"\n{'-'*54}", B)
    log(f" >> [{ts()}] BASLIYOR: {name}", W)
    log(f"{'-'*54}", B)

    for attempt in range(1, 4):
        if attempt > 1:
            log(f"\n  ~> Yeniden deneniyor (deneme {attempt}/3)...", Y)
            time.sleep(10)

        ok, _output = run_claude(task['prompt'], tid, attempt)

        if not ok:
            log(f"  [!] Claude basarisiz (deneme {attempt})", R)
            continue

        log(f"  [+] Claude tamamlandi, degisiklikler kontrol ediliyor...", G)

        # Gercekten dosya degisti mi?
        changes = git_changed_files()
        if not changes:
            log(f"  [!] Dosya degisikligi YOK -- Claude arac kullanmadi!", R)
            log(f"      Olasilik: prompt cok kisa, gorev zaten tamamlandi, veya bir hata var.", Y)
            if attempt < 3:
                log(f"  ~> Daha detayli prompt ile tekrar denenecek...", Y)
            continue

        log(f"  [+] {len(changes)} dosya degisti:", G)
        for f in changes[:10]:
            log(f"      {f}", C)
        if len(changes) > 10:
            log(f"      ... ve {len(changes)-10} daha", C)

        # Migration gerektiren gorevler icin
        if task.get('has_migration'):
            time.sleep(2)
            if not run_migration():
                log(f"  [!] Migration basarisiz -- yeniden deneniyor", R)
                continue

        # Commit
        if git_commit(task['commit_msg']):
            ckpt.setdefault('completed', []).append(tid)
            ckpt[f'{tid}_completed_at'] = datetime.now().isoformat()
            save_ckpt(ckpt)
            log(f"\n  *** {W}{name} TAMAMLANDI!{E}", G)
            return True
        else:
            log(f"  [!] Git commit basarisiz (deneme {attempt})", R)

    log(f"\n{R}[!!] {name} 3 denemede basarisiz oldu.{E}", R)
    log(f"  Tekrar denemek icin: python orchestrator.py --from {tid}", Y)
    return False


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

    print(f"\n{W}{C}  GD360 Orchestrator v2{E}")
    print(f"{C}  {datetime.now().strftime('%Y-%m-%d %H:%M')}  |  claude: {CLAUDE}{E}")
    print(f"{C}  Mod: {'--print YOK (arac kullanimi aktif)'}{E}\n")

    if test_mode:
        # ONEMLI: Bu script aktif bir Claude Code oturumu DISINDA calistirilmali.
        # Iceride (Bash tool ile) calistirildiginda subprocess claude, mevcut oturumu devralir
        # ve gorev yerine ozet yazdirabilir. Dogru kullanim:
        #   Yeni PowerShell/cmd terminali ac → cd C:\Projects\GD360 → python orchestrator.py --test
        log(f"{Y}[TEST MODU] Orchestrator dogrulama basliyor...{E}", Y)
        log(f"{Y}NOT: Bu test Claude Code DISINDA (bagimsiz terminal) calistirildiginda dogru sonuc verir.{E}", Y)
        check_docker()

        # Onceki test dosyasini temizle
        test_file = PROJECT_DIR / 'backend' / 'TEST_ORCHESTRATOR.md'
        if test_file.exists():
            test_file.unlink()
            log(f"  Onceki test dosyasi silindi", Y)

        ok = run_task(TEST_TASK, ckpt)

        if ok and test_file.exists():
            log(f"\n{G}{W}  [TEST GECTI] Claude arac kullandi ve dosya olusturdu!{E}", G)
            log(f"  Dosya: {test_file}", G)
            content_preview = test_file.read_text(encoding='utf-8')[:200]
            log(f"  Icerik onizleme:\n{content_preview}", C)
        elif ok:
            log(f"\n{R}  [TEST BASARISIZ] Claude 'basarili' dedi ama dosya yok!{E}", R)
            log(f"  Hala --print davranisi gosterebilir. Log dosyalarini inceleyin.", Y)
        else:
            log(f"\n{R}  [TEST BASARISIZ] Claude gorevi tamamlayamadi.{E}", R)

        # Test dosyasini commit'e ekleme, temizle
        if test_file.exists():
            subprocess.run(['git', 'checkout', '--', 'backend/TEST_ORCHESTRATOR.md'],
                          cwd=PROJECT_DIR, capture_output=True)
            test_file.unlink(missing_ok=True)
            log(f"  Test dosyasi temizlendi (commit'e eklenmedi)", Y)
        return

    if status_mode:
        print_status(TASKS, ckpt)
        return

    check_docker()
    print_status(TASKS, ckpt)

    skipping = bool(start_from)
    failed   = False

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
            log(f"[SKIP] {task['name']} -- zaten tamamlandi", G)
            continue

        if not run_task(task, ckpt):
            failed = True
            sys.exit(1)

        time.sleep(5)

    print_status(TASKS, ckpt)
    if not failed:
        log(f"{G}{W}  [DONE] Tum moduller basariyla tamamlandi!{E}", G)


if __name__ == '__main__':
    main()
