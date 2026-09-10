import type { State } from './types.js';

export type DeepReadonly<T> = T extends Primitive
  ? T
  : T extends (infer U)[]
    ? readonly DeepReadonly<U>[]
    : { readonly [K in keyof T]: DeepReadonly<T[K]> };

export interface StoreSinks {
  emitChange: () => void;
  scheduleTelegramFlush: () => void;
  writeLocalSync: (next: State) => void;
}

type Primitive = bigint | boolean | null | number | string | symbol | undefined;

const defaultSinks: StoreSinks = {
  // OPTIONAL. Telegram is authoritative for nothing (D3) and its errors are logged,
  // never thrown (D8) — so a no-op here is correct, not a shortcut.
  emitChange: () => {},
  scheduleTelegramFlush: () => {},
  // REQUIRED. A no-op default would mean a forgotten wiring silently stops persisting
  // every mutation — exactly the class of bug D25 scopes tests to.
  writeLocalSync: () => {
    throw new Error('store not configured: writeLocalSync sink missing (see src/index.ts)');
  },
};

let sinks: StoreSinks = { ...defaultSinks };
let state: State | undefined;

export function configureStore(next: Partial<StoreSinks>): void {
  sinks = { ...sinks, ...next };
}

export function getState(): DeepReadonly<State> {
  if (state === undefined) {
    throw new Error('getState() before hydrate()');
  }
  // A plain State is structurally assignable to its DeepReadonly counterpart — TypeScript
  // only enforces readonly-ness on the write side, so no cast is needed here.
  return state;
}

// hydrate() only — never goes through mutate().
export function installState(next: State): void {
  if (state !== undefined) {
    throw new Error('installState() called twice');
  }
  state = next;
}

// The only write path (§6.1, D8). structuredClone -> mutator(next) -> writeLocalSync(next) ->
// commit -> scheduleTelegramFlush -> emitChange. Any throw before the commit line leaves
// `state` untouched and propagates to the request (D8).
//
// Never capture `state` across a mutation — this function rebinds the module-level binding,
// so every reader must call getState() fresh (§6.1). Enforced by an ESLint rule for the
// module-scope case; see eslint.config.mjs.
export function mutate<T>(mutator: (draft: State) => T, options?: { silent?: boolean }): T {
  if (state === undefined) {
    throw new Error('mutate() before hydrate()');
  }
  const next = structuredClone(state);
  const result = mutator(next);
  sinks.writeLocalSync(next);
  state = next; // commit
  sinks.scheduleTelegramFlush();
  if (options?.silent !== true) {
    sinks.emitChange();
  }
  return result;
}

export function resetStoreForTests(): void {
  state = undefined;
  sinks = { ...defaultSinks };
}
