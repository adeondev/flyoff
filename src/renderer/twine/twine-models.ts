export const TWINE_MODELS = [
  { id: 'google/gemma-4-31B-it', label: 'Gemma 4 31B IT' },
  { id: 'google/gemma-4-26B-A4B-it', label: 'Gemma 4 26B A4B IT' },
] as const;

export type TwineModelId = (typeof TWINE_MODELS)[number]['id'];

export const DEFAULT_TWINE_MODEL_ID: TwineModelId =
  'google/gemma-4-31B-it';

const modelIds = new Set<string>(TWINE_MODELS.map(({ id }) => id));

export function isTwineModelId(value: unknown): value is TwineModelId {
  return typeof value === 'string' && modelIds.has(value);
}

export function getTwineModel(modelId: TwineModelId) {
  return TWINE_MODELS.find(({ id }) => id === modelId) ?? TWINE_MODELS[0];
}
