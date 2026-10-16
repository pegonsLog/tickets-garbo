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

/**
 * Como o App Check está operando nesta página:
 * - desligado: sem site key, nenhum token é enviado;
 * - depuracao: localhost com token de depuração (precisa estar registrado no Console);
 * - recaptcha: reCAPTCHA v3 real (site publicado; o domínio precisa estar liberado na chave).
 */
export type ModoAppCheck = 'desligado' | 'depuracao' | 'recaptcha';
let modoAtual: ModoAppCheck = 'desligado';

export function modoAppCheck(): ModoAppCheck {
  return modoAtual;
}

/**
 * O token de depuração só vale em máquina de desenvolvimento.
 * Antes isso dependia de `environment.production`, mas o build de produção usa o
 * mesmo environment.ts (production: false). Resultado: o site publicado também
 * entrava em modo de depuração, gerava um token novo em cada navegador, nunca
 * registrado, e o Firebase recusava todas as chamadas.
 */
function emDesenvolvimentoLocal(): boolean {
  const host = typeof location !== 'undefined' ? location.hostname : '';
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

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
  const depuracao = !!cfg.debugToken && emDesenvolvimentoLocal();
  if (depuracao) {
    (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = cfg.debugToken;
  }

  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true
    });
    appCheckIniciado = true;
    modoAtual = depuracao ? 'depuracao' : 'recaptcha';
  } catch (erro) {
    // Não impede o uso do app: o erro de token aparecerá na chamada, já explicado
    console.error('[Firebase] Falha ao inicializar o App Check', erro);
  }
}

/** Indica se o detalhe de um erro do Firebase é uma recusa do App Check. */
export function ehErroAppCheck(detalhe: string): boolean {
  return /app\s*check/i.test(detalhe ?? '');
}

/**
 * Mensagem acionável para recusa do App Check, conforme o modo em que a página está.
 * Usada por todas as chamadas de IA, para que o diagnóstico seja o mesmo em qualquer tela.
 */
export function explicarErroAppCheck(detalhe: string): string {
  const sufixo = detalhe ? ` (detalhe: ${detalhe.replace(/\s+/g, ' ').trim().slice(0, 300)})` : '';

  // Caso diferente do token recusado: o próprio projeto está bloqueado no Firebase
  // porque o enforcement do App Check está desligado. Nenhum token resolve isso.
  if (/deactivated|must enforce/i.test(detalhe ?? '')) {
    return 'O Firebase desativou o AI Logic neste projeto porque o App Check não está aplicado (enforcement '
      + 'desligado). Isso não é problema do token deste navegador. Para reativar: Console do Firebase > App Check > '
      + 'aba APIs > Firebase AI Logic > Aplicar (Enforce). Antes, registre o token de depuração deste navegador, '
      + 'senão o localhost passa a ser bloqueado.' + sufixo;
  }

  switch (modoAtual) {
    case 'depuracao':
      return 'O App Check recusou o token de depuração deste navegador. Cada navegador (e cada limpeza de '
        + 'dados do site) gera um token diferente. Abra o console do navegador (F12), copie o valor da linha '
        + '"App Check debug token" e registre em Console do Firebase > App Check > Apps > tickets-garbo > '
        + 'Gerenciar tokens de depuração. Depois, recarregue a página.' + sufixo;
    case 'recaptcha':
      return 'O App Check recusou o token do reCAPTCHA. Confira, em google.com/recaptcha/admin, se o domínio '
        + `"${typeof location !== 'undefined' ? location.hostname : ''}" está na lista de domínios da chave, e se a `
        + 'chave secreta cadastrada no App Check é a mesma dessa chave.' + sufixo;
    default:
      return 'Este projeto exige App Check para usar a IA, e o app não está enviando token: preencha '
        + '"appCheck.recaptchaV3SiteKey" em src/environments/environment.ts.' + sufixo;
  }
}

/**
 * Template-Only Mode: configuração do projeto que só aceita chamadas feitas por
 * "server prompt templates". O app chama o modelo diretamente, então é bloqueado.
 */
export function ehErroModoTemplate(detalhe: string): boolean {
  return /template-only mode/i.test(detalhe ?? '');
}

export function explicarErroModoTemplate(): string {
  return 'O projeto está com o "Template-Only Mode" ativado no Firebase AI Logic, que bloqueia chamadas '
    + 'diretas ao modelo, como as deste app. Para liberar: Console do Firebase > AI Logic > aba Configurações '
    + '(Settings) > Template mode > desligue "Enforce template-only mode" e confirme.';
}
