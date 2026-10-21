## 1.6.0 — 2026-10-21
- Share to the app: receipts (photo/PDF/.mht/.html or copied text) shared from WhatsApp/SMS/Files open straight into scan; retry if the scan fails; 6 review fixes
- previous: v1.5.0 (rollback: scripts/rollback.sh 1.5.0)

## 1.5.0 — 2026-10-21
- Digital receipts: upload saved receipt pages (.mht/.html, e.g. Pairzon/Osher Ad) directly in 'scan receipt' — text extracted on the phone, any Hebrew encoding; 7 review fixes
- previous: v1.4.0 (rollback: scripts/rollback.sh 1.4.0)

## 1.4.0 — 2026-10-20
- Shopping catalog 📋: every known product + basics by aisle, tap/stepper quantities and units, edit/remove items already on the list (with undo), add new products; 9 review fixes
- previous: v1.3.0 (rollback: scripts/rollback.sh 1.3.0)

## 1.3.0 — 2026-10-09
- Receipt scan: computerized PDF receipts (multi-page), promotions/deposits ignored, durable items skip stock, automatic warranty cards with shared receipt photo, total sanity check; 'כלי בית' aisle; 7 review fixes
- previous: v1.2.1 (rollback: scripts/rollback.sh 1.2.1)

## 1.2.1 — 2026-10-09
- Receipt scanning live: AI fallback model when busy, unit normalisation; DB migration 002 applied
- previous: v1.2.0 (rollback: scripts/rollback.sh 1.2.0)

## 1.2.0 — 2026-10-09
- Kosher recipe catalogue (107, validated) + public recipe site + scaling/cook mode; shopping list by aisle, quick add (text/voice), estimate & budget, WhatsApp; warranty module; skip tasks + weekly score; undo delete; bottom sheets; self-hosted font; 32 review fixes
- previous: v1.1.2 (rollback: scripts/rollback.sh 1.1.2)

## 1.1.2 — 2026-10-09
- Book-layout app moved to its own repo/address (meirbal.github.io/sefer); /home-app/book/ now redirects there
- previous: v1.1.1 (rollback: scripts/rollback.sh 1.1.1)

## 1.1.1 — 2026-10-08
- Service worker no longer caches the book/ app; release/rollback scripts support APP=book
- previous: v1.1.0 (rollback: scripts/rollback.sh 1.1.0)

## 1.1.0 — 2026-10-08
- Smart stock (units/price/expiry/cycles, auto shopping), home dashboard, recipe dice (36 recipes), task starter packs + member assignment, pets & maintenance modules, receipt scanning (AI, needs setup); 29 review fixes; unit + browser smoke tests
- previous: v1.0.3 (rollback: scripts/rollback.sh 1.0.3)

## 1.0.3 — 2026-10-08
- Hosted on GitHub; restore points as release/* branches
- previous: v1.0.2 (rollback: scripts/rollback.sh 1.0.2)

## 1.0.2 — 2026-10-08
- Connected to Supabase (publishable key); DB advisor fixes (002)
- previous: v1.0.1 (rollback: scripts/rollback.sh 1.0.1)

## 1.0.1 — 2026-10-08
- Post-review fixes (28 items): reliable updates, old-phone support, thumbnails, security hardening
- previous: v1.0.0 (rollback: scripts/rollback.sh 1.0.0)

## 1.0.0 — 2026-10-08
- First release: 8 modules (shopping, products, expenses, routine, periodic, calendar, photos, plans), admin panel, family invite, feature requests, PWA offline shell.
