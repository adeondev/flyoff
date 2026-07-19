export const PROJECT_SEARCH_QUERY_MAX_LENGTH = 2_048;

export type ProjectSearchClause =
  | {
      kind: 'text' | 'path' | 'file' | 'tag' | 'line' | 'section';
      terms: readonly string[];
    }
  | {
      kind: 'property';
      name: string;
      terms: readonly string[];
    };

const PREFIXES = ['section', 'path', 'file', 'tag', 'line'] as const;

function normalizedTerms(value: string): string[] {
  const terms: string[] = [];
  let current = '';
  let quote = '';

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote) {
      if (character === quote) {
        quote = '';
      } else {
        current += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (current.trim()) {
        terms.push(current.trim());
        current = '';
      }
      continue;
    }
    current += character;
  }
  if (current.trim()) {
    terms.push(current.trim());
  }
  return terms;
}

function readOperand(
  query: string,
  start: number,
): { atomic: boolean; end: number; value: string } {
  const first = query[start];
  if (first === '(') {
    let depth = 1;
    let quote = '';
    for (let index = start + 1; index < query.length; index += 1) {
      const character = query[index]!;
      if (quote) {
        if (character === quote) {
          quote = '';
        }
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
        if (depth === 0) {
          return {
            atomic: false,
            end: index + 1,
            value: query.slice(start + 1, index),
          };
        }
      }
    }
    return {
      atomic: false,
      end: query.length,
      value: query.slice(start + 1),
    };
  }
  if (first === '"' || first === "'") {
    const end = query.indexOf(first, start + 1);
    return end === -1
      ? {
          atomic: true,
          end: query.length,
          value: query.slice(start + 1),
        }
      : {
          atomic: true,
          end: end + 1,
          value: query.slice(start + 1, end),
        };
  }

  let end = start;
  while (end < query.length && !/\s/u.test(query[end]!)) {
    end += 1;
  }
  return { atomic: false, end, value: query.slice(start, end) };
}

function operandTerms(
  operand: ReturnType<typeof readOperand>,
): string[] {
  const value = operand.value.trim();
  return operand.atomic && value ? [value] : normalizedTerms(value);
}

export function parseProjectSearchQuery(query: string): ProjectSearchClause[] {
  const source = query.slice(0, PROJECT_SEARCH_QUERY_MAX_LENGTH);
  const clauses: ProjectSearchClause[] = [];
  const plainTerms: string[] = [];
  let index = 0;

  while (index < source.length) {
    while (index < source.length && /\s/u.test(source[index]!)) {
      index += 1;
    }
    if (index >= source.length) {
      break;
    }

    if (source[index] === '[') {
      const closing = source.indexOf(']', index + 1);
      if (closing !== -1) {
        const expression = source.slice(index + 1, closing).trim();
        const separator = expression.indexOf(':');
        const name =
          separator === -1
            ? expression
            : expression.slice(0, separator).trim();
        let terms =
          separator === -1
            ? []
            : normalizedTerms(expression.slice(separator + 1));
        index = closing + 1;
        if (terms.length === 0 && source[index] === ':') {
          const operand = readOperand(source, index + 1);
          terms = operandTerms(operand);
          index = operand.end;
        }
        if (name) {
          clauses.push({ kind: 'property', name, terms });
          continue;
        }
      }
    }

    const remainder = source.slice(index);
    const prefix = PREFIXES.find((candidate) =>
      remainder.toLocaleLowerCase().startsWith(`${candidate}:`),
    );
    if (prefix) {
      const operand = readOperand(source, index + prefix.length + 1);
      const terms = operandTerms(operand);
      if (terms.length > 0) {
        clauses.push({ kind: prefix, terms });
      }
      index = operand.end;
      continue;
    }

    const operand = readOperand(source, index);
    plainTerms.push(...operandTerms(operand));
    index = operand.end;
  }

  if (plainTerms.length > 0) {
    clauses.unshift({ kind: 'text', terms: plainTerms });
  }
  return clauses;
}

export function normalizeProjectSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
}
