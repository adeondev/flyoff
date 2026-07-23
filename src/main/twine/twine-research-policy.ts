import type { TwineGenerationRequest } from '../../shared/contracts';

const EXPLICIT_RESEARCH_PATTERNS = [
  /\b(?:pesquis\w*|bus(?:c|qu)\w*|procure\w*|consulte\w*|verifique\w*)\b.*\b(?:internet|web|google|online|fontes?|links?)\b/u,
  /\b(?:pesquis\w*|search\w*|browse\w*|google)\b/u,
  /\b(?:search|look\s+up|browse)\b/u,
  /\b(?:fuentes?|enlaces?)\b/u,
];

const CURRENT_INFORMATION_PATTERNS = [
  /\b(?:ultim\w*|mais\s+recent\w*|recent\w*|atual(?:mente)?|hoje|agora|neste\s+momento)\b/u,
  /\b(?:latest|newest|most\s+recent|current(?:ly)?|today|right\s+now)\b/u,
  /\b(?:ultimo|mas\s+reciente|actual(?:mente)?|hoy|ahora)\b/u,
  /\b(?:noticias?|news|novidades?|acontecimentos?\s+recentes?)\b/u,
  /\b(?:precos?|cotacao|bolsa|cambio|taxa\s+de\s+juros|inflacao)\b/u,
  /\b(?:prices?|stock\s+price|exchange\s+rate|interest\s+rate|inflation)\b/u,
  /\b(?:precios?|cotizacion|tipo\s+de\s+cambio)\b/u,
  /\b(?:previsao\s+do\s+tempo|meteorologia|weather\s+forecast|pronostico\s+del\s+tiempo)\b/u,
  /\b(?:disponibilidade|em\s+estoque|availability|in\s+stock|disponibilidad)\b/u,
  /\b(?:presidente|primeiro-ministro|governador|prefeito|ministro|ceo|diretor-executivo)\b/u,
  /\b(?:president|prime\s+minister|governor|mayor|chief\s+executive)\b/u,
  /\b(?:eleicao|elecciones|election|ranking|classificacao|standings|placar|score)\b/u,
];

const PRODUCT_MODEL_PATTERN =
  /\b(?:chatgpt|openai|claude|anthropic|gemini|gemma)\b.*\b(?:modelo|model|versao|version)\b|\b(?:modelo|model|versao|version)\b.*\b(?:chatgpt|openai|claude|anthropic|gemini|gemma)\b/u;

const EVENT_RESULT_PATTERN =
  /\b(?:quem|who|quien)\s+(?:ganhou|venceu|won|gano)|\b(?:campea\w*|champion|winner|vencedor\w*)\b/u;

const UPCOMING_EVENT_PATTERN =
  /\b(?:quando|when|cuanto)\b.*\b(?:sera|acontece|comeca|vai\s+ser|will|start|happen)\b/u;

function normalizeForMatching(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/gu, ' ')
    .trim();
}

function mentionedYears(value: string): number[] {
  const years = Array.from(value.matchAll(/\b(20\d{2})\b/gu), (match) =>
    Number(match[1]),
  );
  for (const match of value.matchAll(
    /\b(?:de|em|in|del)\s+['’]?(\d{2})\b/gu,
  )) {
    years.push(2000 + Number(match[1]));
  }
  return years;
}

function isStrictlyHistorical(value: string, currentYear: number): boolean {
  const years = mentionedYears(value);
  return years.length > 0 && years.every((year) => year < currentYear - 1);
}

export function shouldRequireTwineResearch(
  request: TwineGenerationRequest,
  currentDate = new Date(),
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

  if (EXPLICIT_RESEARCH_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (CURRENT_INFORMATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return !isStrictlyHistorical(text, currentDate.getUTCFullYear());
  }
  if (PRODUCT_MODEL_PATTERN.test(text)) {
    return true;
  }
  if (
    EVENT_RESULT_PATTERN.test(text) ||
    UPCOMING_EVENT_PATTERN.test(text)
  ) {
    return !isStrictlyHistorical(text, currentDate.getUTCFullYear());
  }

  return false;
}
