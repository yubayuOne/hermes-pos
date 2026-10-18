/**
 * Expo config plugin: gives React Native's OkHttp client an HTTP/2 ping.
 *
 * React Native builds its OkHttp client with no timeouts and no ping. After the device goes offline and back
 * online, the pooled HTTP/2 connection to the server can be dead without the socket knowing, and every new
 * request is sent on it and never answered until the app is restarted. A ping every 10 s finds the dead
 * connection, closes it, and the next request opens a fresh one.
 *
 * Idempotent: safe to run on an android/ folder that is already patched.
 */
const { withMainApplication } = require('expo/config-plugins');

const IMPORTS = ['import com.facebook.react.modules.network.OkHttpClientProvider', 'import java.util.concurrent.TimeUnit'];
const FACTORY =
  '    OkHttpClientProvider.setOkHttpClientFactory {\n' +
  '      OkHttpClientProvider.createClientBuilder(applicationContext).pingInterval(10, TimeUnit.SECONDS).build()\n' +
  '    }\n';

module.exports = function withHttpPing(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes('setOkHttpClientFactory')) return cfg;
    if (!/super\.onCreate\(\)\s*\n/.test(src)) {
      throw new Error('withHttpPing: cannot find super.onCreate() in MainApplication.kt; set the OkHttp factory manually.');
    }
    src = src.replace(/(import android\.app\.Application\s*\n)/, `$1${IMPORTS.join('\n')}\n`);
    src = src.replace(/(super\.onCreate\(\)\s*\n)/, `$1${FACTORY}`);
    cfg.modResults.contents = src;
    return cfg;
  });
};
