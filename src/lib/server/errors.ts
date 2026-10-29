export class DomainError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
    this.name = 'DomainError';
  }
}

export function assertInput(condition: unknown, message: string): asserts condition {
  if (!condition) throw new DomainError(message);
}
