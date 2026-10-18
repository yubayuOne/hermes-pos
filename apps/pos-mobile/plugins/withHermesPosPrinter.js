/**
 * Expo config plugin: installs the HERMES POS Bluetooth printer native module.
 *
 * Keeps the native pieces alive across `expo prebuild --clean`:
 *  - Bluetooth permissions in AndroidManifest.xml
 *  - Kotlin sources copied into android/app/src/main/java/com/hermespos/pos/printer
 *  - HermesPosBluetoothPrinterPackage registered in MainApplication.kt
 *
 * Idempotent: safe to run on an android/ folder that is already patched.
 */
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withMainApplication, withDangerousMod } = require('expo/config-plugins');

const PACKAGE_DIR = ['com', 'hermespos', 'pos', 'printer'];
const SOURCES = ['HermesPosBluetoothPrinterModule.kt', 'HermesPosBluetoothPrinterPackage.kt'];

const PERMISSIONS = [
  { name: 'android.permission.BLUETOOTH', maxSdkVersion: '30' },
  { name: 'android.permission.BLUETOOTH_ADMIN', maxSdkVersion: '30' },
  { name: 'android.permission.BLUETOOTH_CONNECT' },
];

function withPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const list = (manifest['uses-permission'] = manifest['uses-permission'] || []);
    for (const perm of PERMISSIONS) {
      if (list.some((p) => p.$['android:name'] === perm.name)) continue;
      const attrs = { 'android:name': perm.name };
      if (perm.maxSdkVersion) attrs['android:maxSdkVersion'] = perm.maxSdkVersion;
      list.push({ $: attrs });
    }
    const features = (manifest['uses-feature'] = manifest['uses-feature'] || []);
    if (!features.some((f) => f.$['android:name'] === 'android.hardware.bluetooth')) {
      features.push({ $: { 'android:name': 'android.hardware.bluetooth', 'android:required': 'false' } });
    }
    return cfg;
  });
}

function withKotlinSources(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const target = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', ...PACKAGE_DIR);
      fs.mkdirSync(target, { recursive: true });
      for (const file of SOURCES) {
        fs.copyFileSync(path.join(__dirname, 'hermes-pos-printer', file), path.join(target, file));
      }
      return cfg;
    },
  ]);
}

function withPackageRegistration(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes('HermesPosBluetoothPrinterPackage')) return cfg;

    const importLine = 'import com.hermespos.pos.printer.HermesPosBluetoothPrinterPackage';
    src = src.replace(/(import com\.facebook\.react\.PackageList\s*\n)/, `$1${importLine}\n`);

    if (/\/\/\s*add\(MyReactNativePackage\(\)\)/.test(src)) {
      src = src.replace(/(\s*)\/\/\s*add\(MyReactNativePackage\(\)\)/, '$1add(HermesPosBluetoothPrinterPackage())');
    } else if (/PackageList\(this\)\.packages\.apply\s*\{/.test(src)) {
      src = src.replace(/(PackageList\(this\)\.packages\.apply\s*\{)/, '$1\n          add(HermesPosBluetoothPrinterPackage())');
    } else {
      throw new Error(
        'withHermesPosPrinter: cannot find PackageList(this).packages in MainApplication.kt; register HermesPosBluetoothPrinterPackage manually.',
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withHermesPosPrinter(config) {
  config = withPermissions(config);
  config = withKotlinSources(config);
  config = withPackageRegistration(config);
  return config;
};
