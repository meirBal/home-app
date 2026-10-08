# ניהול הבית — HomeApp

PWA משפחתית (ללא build, ללא עלות): GitHub Pages + Supabase Free.

## מבנה (סקשנים לפי אזור עניין)
| קובץ | אחריות |
|---|---|
| `js/config.js` | גרסה, כתובת שרת, פרופיל מכשיר (LITE) |
| `js/core/api.js` | כל הגישה לשרת: התחברות, משק בית, רשומות, תמונות, Realtime |
| `js/core/modules.js` | הגדרת המודולים כנתונים + אימות + חזרתיות משימות |
| `js/core/ui.js` | DOM, טפסים מסכמה, חלונות, הודעות |
| `js/core/state.js` | מצב משותף |
| `js/views/module.js` | תצוגה גנרית: רשימה / יומן / גלריה |
| `js/views/admin.js` | ממשק ניהול: מודולים, משתמשים, הזמנה, בקשות פיצ'רים |
| `js/views/auth.js` | כניסה, הרשמה, יצירה/הצטרפות למשק בית |
| `js/app.js` | אתחול, ניווט, עדכוני גרסה |
| `sql/` | מיגרציות מסד נתונים (ממוספרות, לא עורכים קובץ שכבר רץ) |
| `scripts/` | release / rollback |

## התקנה חד-פעמית
1. Supabase → SQL Editor → להדביק את `sql/001_schema.sql` → Run.
2. Supabase → Authentication → Sign In / Providers → Email → לכבות **Confirm email** (שירות המייל החינמי של Supabase שולח רק לחברי הצוות).
3. Supabase → Project Settings → API Keys → להעתיק את ה-**Publishable / anon** ל-`js/config.js`.
4. GitHub → `meirBal/home-app` → Settings → Pages → Branch `main` / root (חד-פעמי).
5. בטלפון: לפתוח `https://meirbal.github.io/home-app/` → "הוספה למסך הבית".

## גרסאות
- שחרור: `scripts/release.sh 1.1.0 "מה השתנה"` — מעדכן גרסה ו-CHANGELOG, מעלה ל-main ושומר ענף `release/vX.Y.Z` כנקודת שחזור.
- חזרה: `scripts/rollback.sh 1.0.0` — משחזר כגרסה חדשה (היסטוריה לא נמחקת).
- שינוי סכמה: קובץ חדש `sql/00N_*.sql`, לעולם לא עריכת קובץ שכבר הורץ.
