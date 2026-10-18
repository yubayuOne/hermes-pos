import app from '../app.json';

/** Every brand name and contact comes from here (PRD X5). Square brackets are placeholders to replace before release. */
export const BRAND = {
  name: 'HERMES POS',
  wordmark: 'hermes pos',
  appName: 'HERMES POS',
  backofficeHost: 'backoffice.hermes-pos.com',
  whatsapp: '[NOMOR WHATSAPP]',
  version: app.expo.version,
} as const;

/** Owner's emblem (Hermes on orange) cut to a circle: splash, rail, cashier list. Same art as the app icon. */
export const BRAND_MARK = require('../assets/hermes.png');
/** "HERMES POS" banner, 1254 × 706: sign-in screen. */
export const BRAND_BANNER = require('../assets/hermes-banner.jpg');
export const BRAND_BANNER_RATIO = 1254 / 706;
