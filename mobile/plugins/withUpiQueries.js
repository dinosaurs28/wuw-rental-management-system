// Android 11+ package visibility: Linking.canOpenURL('upi://pay') always
// returns false unless the manifest declares the scheme in <queries>. The app
// uses it (lib/razorpay.ts → hasUpiApp) to offer "Scan QR to pay" first on
// phones with no UPI app installed. Idempotent across repeated prebuilds.
const { withAndroidManifest } = require('expo/config-plugins');

const VIEW_ACTION = 'android.intent.action.VIEW';

function isUpiViewIntent(intent) {
  const actions = intent.action ?? [];
  const data = intent.data ?? [];
  return (
    actions.some((a) => a.$?.['android:name'] === VIEW_ACTION) &&
    data.some((d) => d.$?.['android:scheme'] === 'upi')
  );
}

const withUpiQueries = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries ?? [];
    if (manifest.queries.some((q) => (q.intent ?? []).some(isUpiViewIntent))) return cfg;

    if (manifest.queries.length === 0) manifest.queries.push({});
    const queries = manifest.queries[0];
    queries.intent = queries.intent ?? [];
    queries.intent.push({
      action: [{ $: { 'android:name': VIEW_ACTION } }],
      data: [{ $: { 'android:scheme': 'upi' } }],
    });
    return cfg;
  });

module.exports = withUpiQueries;
