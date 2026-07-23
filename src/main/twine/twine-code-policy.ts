import type { TwineGenerationRequest } from '../../shared/contracts';

const EXPLICIT_EXECUTION_PATTERNS = [
  /\b(?:execute|executa|executar|rode|rodar|run)\b.*\b(?:codigo|code|python|script|programa|testes?|tests?)\b/u,
  /\b(?:confira|confere|verifique|valide|teste)\b.*\b(?:com|usando)\s+(?:codigo|code|python)\b/u,
  /\b(?:use|usando|with)\s+(?:codigo|code|python)\b.*\b(?:calcule|conte|compute|count|verifique|validate|check)\b/u,
  /\b(?:code\s+execution|execucao\s+de\s+codigo)\b/u,
];

const COUNTING_PATTERN =
  /\b(?:conte|contar|quantas?|quantos?|count|how\s+many)\b/u;

const COMPLEX_CALCULATION_PATTERN =
  /\b(?:calcule|calcular|compute|soma|somatorio|produto|media|mediana|desvio\s+padrao|estatistica|converta|conversao)\b/u;

const ALGORITHM_VALIDATION_PATTERN =
  /\b(?:implemente|implement|escreva|write|crie|create)\b.*\b(?:funcao|function|algoritmo|algorithm|codigo|code|python|javascript|typescript)\b.*\b(?:teste|testes|tests?|valide|validate|execute|run|rode)\b/u;

function normalizeForMatching(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function shouldRequireTwineCodeExecution(
  request: TwineGenerationRequest,
): boolean {
  const latestUserMessage = request.messages.findLast(
    (message) => message.role === 'user',
  );
  if (!latestUserMessage) {
    return false;
  }

  const text = normalizeForMatching(latestUserMessage.text);
  if (!text) {
    return false;
  }

  if (EXPLICIT_EXECUTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (ALGORITHM_VALIDATION_PATTERN.test(text)) {
    return true;
  }
  if (COUNTING_PATTERN.test(text) && latestUserMessage.text.length >= 100) {
    return true;
  }
  if (
    COMPLEX_CALCULATION_PATTERN.test(text) &&
    (/\d{4,}/u.test(text) ||
      (text.match(/[+\-*/%^=<>]/gu)?.length ?? 0) >= 2)
  ) {
    return true;
  }

  return false;
}
