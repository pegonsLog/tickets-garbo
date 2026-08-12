import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { ReCaptchaV3Provider, initializeAppCheck } from 'firebase/app-check';
import { environment } from '../../environments/environment';

/**
 * Inicialização única do Firebase (app + App Check).
 *
 * O App Check precisa ser inicializado antes da primeira chamada aos serviços do
 * Firebase. Quando o enforcement está ativado no console, requisições sem um token
 * válido são recusadas com HTTP 401 ("Firebase App Check token is invalid").
 *
 * A ativação depende de `environment.appCheck.recaptchaV3SiteKey`. Sem essa chave,
 * o App Check não é inicializado — o que só funciona se o enforcement estiver
 * desligado no console.
 */

let appCache: FirebaseApp | undefined;
let appCheckIniciado = false;

/** Configuração opcional de App Check lida do environment. */
interface ConfigAppCheck {
  /** Site key do reCAPTCHA v3 gerada no Console do Firebase (App Check). */
  recaptchaV3SiteKey?: string;
  /**
   * Token de depuração para uso em localhost.
   * `true` gera um token novo (exibido no console do navegador, precisa ser
   * registrado no Console) ou informe a string de um token já registrado.
   */
  debugToken?: boolean | string;
}

export function obterFirebaseApp(): FirebaseApp {
  if (appCache) return appCache;

  const config = (environment as any).firebase;
  if (!config?.apiKey || !config?.projectId) {
    throw new Error('Configuração do Firebase ausente em src/environments/environment.ts (chave "firebase").');
  }

  appCache = getApps().length ? getApp() : initializeApp(config);
  iniciarAppCheck(appCache);
  return appCache;
}

/** Indica se o App Check foi efetivamente ativado (usado nas mensagens de erro). */
export function appCheckAtivo(): boolean {
  return appCheckIniciado;
}

function iniciarAppCheck(app: FirebaseApp): void {
  if (appCheckIniciado) return;

  const cfg: ConfigAppCheck = (environment as any).appCheck ?? {};
  const siteKey = (cfg.recaptchaV3SiteKey ?? '').trim();
  if (!siteKey) return;

  // O token de depuração precisa ser definido antes de initializeAppCheck
  if (cfg.debugToken && !environment.production) {
    (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = cfg.debugToken;
  }

  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true
    });
    appCheckIniciado = true;
  } catch (erro) {
    // Não impede o uso do app: o erro de token aparecerá na chamada, já explicado
    console.error('[Firebase] Falha ao inicializar o App Check', erro);
  }
}
