import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  AppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider, getToken, initializeAppCheck
} from 'firebase/app-check';
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
let appCheckInstancia: AppCheck | undefined;

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

/** Corpo da última resposta de erro do servidor do App Check (motivo real da recusa). */
let ultimaRecusaAppCheck = '';

/**
 * O SDK do App Check descarta o corpo das respostas de erro da troca de token e
 * informa só "400 error". Este interceptador lê esse corpo (apenas para as URLs de
 * troca do App Check, sem alterar a requisição nem a resposta) para o diagnóstico.
 */
function capturarRespostasDoAppCheck(): void {
  if (typeof window === 'undefined' || (window as any).__capturaAppCheck) return;
  (window as any).__capturaAppCheck = true;

  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const resposta = await fetchOriginal(entrada, init);
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (!resposta.ok && /firebaseappcheck\.googleapis\.com/.test(url) && /:exchange/i.test(url)) {
      resposta.clone().text()
        .then(corpo => {
          ultimaRecusaAppCheck = `HTTP ${resposta.status}: ${corpo.replace(/\s+/g, ' ').trim()}`;
          console.error('[Firebase] Resposta do App Check na troca do token', ultimaRecusaAppCheck);
        })
        .catch(() => { /* sem corpo legível: o diagnóstico usa só o código */ });
    }
    return resposta;
  };
}

/** Configuração opcional de App Check lida do environment. */
interface ConfigAppCheck {
  /** Site key do reCAPTCHA (o nome do campo foi mantido por compatibilidade). */
  recaptchaV3SiteKey?: string;
  /**
   * Tipo da chave do reCAPTCHA:
   * - 'enterprise': chave criada vinculada a um projeto do Google Cloud (reCAPTCHA Enterprise).
   *   No App Check, o app é registrado na opção "reCAPTCHA Enterprise", só com a site key.
   * - 'v3': chave clássica, com chave secreta, registrada na opção "reCAPTCHA".
   * Usar o tipo errado faz a troca do token falhar com "AppCheck: 400 error".
   */
  provedor?: 'enterprise' | 'v3';
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

  capturarRespostasDoAppCheck();

  // O token de depuração precisa ser definido antes de initializeAppCheck
  const depuracao = !!cfg.debugToken && emDesenvolvimentoLocal();
  if (depuracao) {
    (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = cfg.debugToken;
  }

  try {
    const provider = cfg.provedor === 'enterprise'
      ? new ReCaptchaEnterpriseProvider(siteKey)
      : new ReCaptchaV3Provider(siteKey);
    appCheckInstancia = initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
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
      return 'O App Check recusou o token do reCAPTCHA deste site '
        + `("${typeof location !== 'undefined' ? location.hostname : ''}"). O motivo exato aparece no navegador: `
        + 'F12 > aba Rede (Network) > requisição "exchangeRecaptcha..." > aba Resposta.' + sufixo;
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

/**
 * Pede um token novo ao App Check e devolve o motivo da falha, se houver.
 *
 * Quando a troca do token falha, o SDK do App Check não interrompe a chamada à IA:
 * ele envia um token inválido, e o servidor responde só "token is invalid". O motivo
 * real (domínio não liberado, chave secreta errada, pontuação baixa) fica nesta etapa,
 * por isso ela é consultada separadamente para montar o diagnóstico.
 */
export async function diagnosticarAppCheck(): Promise<string> {
  if (!appCheckInstancia) return '';
  try {
    // Sem forçar renovação: cada troca nova consulta o reCAPTCHA de novo, e uma nota baixa
    // dispara bloqueio de até 1 dia. Aqui basta saber se existe um token válido.
    await getToken(appCheckInstancia, false);
    return 'TOKEN_OK';
  } catch (erro: any) {
    console.error('[Firebase] Falha ao obter o token do App Check', erro);
    // Dá tempo para o interceptador terminar de ler o corpo da resposta
    await new Promise(r => setTimeout(r, 300));
    const motivo = String(erro?.message ?? erro);
    return ultimaRecusaAppCheck ? `${motivo} | Resposta do servidor: ${ultimaRecusaAppCheck}` : motivo;
  }
}

/** Traduz o motivo da falha na obtenção do token em uma orientação concreta. */
export function explicarFalhaToken(motivo: string): string {
  const host = typeof location !== 'undefined' ? location.hostname : '';
  if (!motivo) return '';
  if (motivo === 'TOKEN_OK') {
    return ' Causa encontrada: o App Check emitiu um token válido, mas o Firebase AI Logic o recusou. '
      + 'Normalmente isso indica a "proteção contra repetição" ligada para o AI Logic (Console do Firebase > '
      + 'App Check > APIs > Firebase AI Logic). O app já envia tokens de uso único; se o erro continuar, '
      + 'desative essa proteção.';
  }
  if (/recaptcha/i.test(motivo) && !/http status|fetch-status|403|400/i.test(motivo)) {
    return ` Causa encontrada: o reCAPTCHA não gerou o token neste site. Normalmente o domínio "${host}" `
      + 'não está na lista de domínios da chave, ou a chave não é do tipo v3 (pontuação). '
      + `Motivo: ${motivo}`;
  }
  if (/403|400|fetch-status-error/i.test(motivo)) {
    const enterprise = ((environment as any).appCheck?.provedor) === 'enterprise';
    return ' Causa encontrada: o App Check recusou a validação do reCAPTCHA. '
      + (enterprise
        ? 'O app está usando o provedor reCAPTCHA Enterprise: confira se, em App Check > Apps > tickets-garbo, '
          + 'o provedor registrado é "reCAPTCHA Enterprise" com a mesma site key, e se a API "reCAPTCHA Enterprise" '
          + 'está ativada no Google Cloud.'
        : 'Se a chave foi criada vinculada a um projeto do Google Cloud, ela é do tipo Enterprise: defina '
          + 'appCheck.provedor = "enterprise" no environment.ts e registre o app na opção "reCAPTCHA Enterprise". '
          + 'Se for uma chave clássica, a chave secreta no App Check não corresponde à site key.')
      + ` Motivo: ${motivo}`;
  }
  if (/throttl/i.test(motivo)) {
    return ' Causa encontrada: muitas falhas seguidas bloquearam temporariamente as tentativas. '
      + `Corrija a configuração, aguarde cerca de 1 dia ou limpe os dados do site. Motivo: ${motivo}`;
  }
  return ` Motivo informado pelo App Check: ${motivo}`;
}

/**
 * Se o erro foi um token de App Check recusado (e não o projeto bloqueado), acrescenta
 * à mensagem o motivo real obtido ao pedir um token novo.
 */
export async function comDiagnosticoAppCheck(erro: unknown, mensagem: string): Promise<string> {
  const detalhe = String((erro as any)?.message ?? erro ?? '');
  if (!ehErroAppCheck(detalhe) || /deactivated|must enforce/i.test(detalhe)) return mensagem;
  return mensagem + explicarFalhaToken(await diagnosticarAppCheck());
}
