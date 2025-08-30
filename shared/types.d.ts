
// Global type definitions for missing ES2021/ES2022 types

declare global {
  interface AggregateError extends Error {
    errors: any[];
    constructor(errors: Iterable<any>, message?: string): AggregateError;
  }

  interface ErrorOptions {
    cause?: unknown;
  }

  interface ErrorConstructor {
    new(message?: string, options?: ErrorOptions): Error;
    (message?: string, options?: ErrorOptions): Error;
  }

  var AggregateError: {
    prototype: AggregateError;
    new(errors: Iterable<any>, message?: string): AggregateError;
    (errors: Iterable<any>, message?: string): AggregateError;
  };
}

export {};
