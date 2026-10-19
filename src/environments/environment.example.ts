// Copie este arquivo para "environment.ts" e preencha com suas chaves reais.
// O arquivo environment.ts é ignorado pelo Git (não deve conter segredos versionados).
//
// A análise de similaridade por IA usa o Firebase AI Logic com a mesma configuração
// abaixo (bloco "firebase"). Antes do primeiro uso, no Console do Firebase:
//   1. Abra o projeto > AI Logic e clique em "Começar";
//   2. Escolha o provedor "Gemini Developer API" (é o que possui nível sem custo);
//   3. Confirme que o app web está registrado neste projeto.
// Recomendado em produção: ativar o Firebase App Check para impedir uso da chave
// por outros domínios, e restringir a chave de API aos domínios da aplicação.
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
  },

  // App Check. Obrigatório quando o enforcement está ativado no Console
  // (sem ele, a IA responde "Firebase App Check token is invalid", HTTP 401).
  //   1. Console do Firebase > App Check > registre o app web com reCAPTCHA v3;
  //   2. cole abaixo a site key gerada;
  //   3. para rodar em localhost, deixe debugToken como true, abra o app, copie o
  //      token exibido no console do navegador e registre-o em
  //      App Check > seu app > Gerenciar tokens de depuração.
  // Deixe recaptchaV3SiteKey vazio para não inicializar o App Check.
  appCheck: {
    recaptchaV3SiteKey: '',
    // 'enterprise' para chaves criadas vinculadas a um projeto do Google Cloud (registre o app
    // no App Check como "reCAPTCHA Enterprise"); 'v3' para chaves clássicas com chave secreta.
    provedor: 'enterprise',
    debugToken: true
  }
};
