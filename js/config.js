// ===== CONFIG — the only file to edit per deployment =====
export const VERSION = '1.2.0';
export const SUPABASE_URL = 'https://enhqzgjqqyubgfysnjib.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_w3aqbIxj_ECmMOUhANPebw_thGqD9o1'; // public key only — never the service/secret key

// Device profile: weak devices / data-saver get smaller images & pages.
const mem = navigator.deviceMemory || 4;
export const LITE = mem <= 2 || !!navigator.connection?.saveData;
export const IMG_MAX = LITE ? 960 : 1600;   // px, longest side after client-side resize
export const PAGE = LITE ? 50 : 150;        // rows per list fetch
