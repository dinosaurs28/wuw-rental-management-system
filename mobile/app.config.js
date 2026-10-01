// Extends app.json (which stays the source of truth) with the Android Firebase
// config that Expo push needs: without it getExpoPushTokenAsync throws
// "Default FirebaseApp is not initialized" and no Android device registers.
//
// Ops: register the Android app (package from app.json) in a Firebase project,
// then EITHER upload its google-services.json as an EAS file variable named
// GOOGLE_SERVICES_JSON (`eas env:create --type file --name GOOGLE_SERVICES_JSON`)
// OR place it at mobile/google-services.json. Sending also needs the FCM V1
// service-account key uploaded to EAS credentials. Until then the build is
// unchanged and lib/push.ts skips push (and its permission prompt) on Android.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  if (config.android?.googleServicesFile) return config;
  const fromEas = process.env.GOOGLE_SERVICES_JSON;
  const local = fs.existsSync(path.join(__dirname, 'google-services.json')) ? './google-services.json' : undefined;
  const googleServicesFile = fromEas || local;
  if (!googleServicesFile) return config;
  return { ...config, android: { ...config.android, googleServicesFile } };
};
