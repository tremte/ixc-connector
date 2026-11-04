export class IxcError extends Error {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, options: { retryable?: boolean; status?: number } = {}) {
    super(message);
    this.name = 'IxcError';
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

export class ReadOnlyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadOnlyViolation';
  }
}
