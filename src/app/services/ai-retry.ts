/**
 * Retentativa para falhas temporárias do serviço de IA.
 *
 * Só repete erros transitórios do lado do Google (HTTP 500/502/503/504, "high demand",
 * "overloaded"). Não repete erros de configuração (401/403), de requisição (400/404)
 * nem de cota (429): repetir esses só gastaria cota e tempo.
 */

/** Esperas entre as tentativas, em milissegundos (3 tentativas extras no total). */
const ESPERAS_MS = [2000, 5000, 10000];

export function ehErroTransitorio(erro: unknown): boolean {
  const e = erro as any;
  const status = e?.customErrorData?.status;
  if (typeof status === 'number' && [500, 502, 503, 504].includes(status)) return true;
  return /high demand|overloaded|unavailable|try again later/i.test(String(e?.message ?? ''));
}

/**
 * Executa a chamada e, em caso de falha transitória, tenta de novo com espera crescente.
 * @param aoRepetir avisado antes de cada nova tentativa (para mostrar progresso na tela)
 */
export async function comRetentativa<T>(
  chamada: () => Promise<T>,
  aoRepetir: (tentativa: number, total: number) => void = () => {}
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await chamada();
    } catch (erro) {
      if (i >= ESPERAS_MS.length || !ehErroTransitorio(erro)) throw erro;
      console.warn(`[IA] Serviço sobrecarregado; nova tentativa ${i + 2} de ${ESPERAS_MS.length + 1}`, erro);
      aoRepetir(i + 2, ESPERAS_MS.length + 1);
      await new Promise(r => setTimeout(r, ESPERAS_MS[i]));
    }
  }
}

/** Mensagem para quando o serviço continua sobrecarregado mesmo após as retentativas. */
export function explicarSobrecarga(modelo: string): string {
  return `O modelo "${modelo}" está sobrecarregado no momento (alta demanda no Google) e não respondeu `
    + 'mesmo após novas tentativas. Isso costuma passar em alguns minutos. Tente novamente mais tarde ou '
    + 'selecione outro modelo na lista (por exemplo, o Flash-Lite).';
}
