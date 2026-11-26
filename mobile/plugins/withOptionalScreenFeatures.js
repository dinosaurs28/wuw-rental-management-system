// Google Play (Nov 2026, release 1.1.1): "Required hardware feature
// declarations are restricting your app's availability —
// android.hardware.screen.portrait". The app is locked to portrait
// ("orientation": "portrait" → android:screenOrientation="portrait"), and Play
// treats that as an implied *required* portrait screen, hiding the app from
// tablets, Chromebooks/desktop and XR devices. Declaring the screen features
// explicitly with required="false" keeps the portrait lock but removes the
// install restriction. Idempotent across repeated prebuilds.
const { withAndroidManifest } = require('expo/config-plugins');

const FEATURES = ['android.hardware.screen.portrait', 'android.hardware.screen.landscape'];

const withOptionalScreenFeatures = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-feature'] = manifest['uses-feature'] ?? [];
    for (const name of FEATURES) {
      const existing = manifest['uses-feature'].find((f) => f.$?.['android:name'] === name);
      if (existing) existing.$['android:required'] = 'false';
      else manifest['uses-feature'].push({ $: { 'android:name': name, 'android:required': 'false' } });
    }
    return cfg;
  });

module.exports = withOptionalScreenFeatures;
