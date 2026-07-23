// Copie este arquivo para "environment.ts" e preencha com suas chaves reais.
// O arquivo environment.ts é ignorado pelo Git (não deve conter segredos versionados).
export const environment = {
  production: false,
  apiKey: 'SUA_GOOGLE_SHEETS_API_KEY', // API key do Google Sheets

  firebase: {
    apiKey: 'SUA_FIREBASE_API_KEY',
    authDomain: 'SEU_PROJETO.firebaseapp.com',
    projectId: 'SEU_PROJETO',
    storageBucket: 'SEU_PROJETO.firebasestorage.app',
    messagingSenderId: 'SEU_SENDER_ID',
    appId: 'SEU_APP_ID',
    measurementId: 'SEU_MEASUREMENT_ID'
  }
};
