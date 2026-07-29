export interface SourceTextChange {
  from: number;
  insert: string;
  to: number;
}

interface SourceChangeValidation {
  after: string;
  applicable: boolean;
  before: string;
  from: number;
  insert: string;
  to: number;
}

const validations = new WeakMap<SourceTextChange, SourceChangeValidation>();

export function isSourceTextChangeApplicable(
  before: string,
  after: string,
  change: SourceTextChange,
): boolean {
  if (
    !Number.isSafeInteger(change.from) ||
    !Number.isSafeInteger(change.to) ||
    change.from < 0 ||
    change.to < change.from ||
    change.to > before.length ||
    after.length !==
      before.length - (change.to - change.from) + change.insert.length
  ) {
    return false;
  }

  const cached = validations.get(change);
  if (
    cached &&
    cached.before === before &&
    cached.after === after &&
    cached.from === change.from &&
    cached.to === change.to &&
    cached.insert === change.insert
  ) {
    return cached.applicable;
  }

  const insertedEnd = change.from + change.insert.length;
  const applicable =
    after.slice(change.from, insertedEnd) === change.insert &&
    before.slice(0, change.from) === after.slice(0, change.from) &&
    before.slice(change.to) === after.slice(insertedEnd);
  validations.set(change, {
    after,
    applicable,
    before,
    from: change.from,
    insert: change.insert,
    to: change.to,
  });
  return applicable;
}
