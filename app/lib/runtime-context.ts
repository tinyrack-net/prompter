import { createContext, type RouterContext } from 'react-router';
import type { PrompterDocument } from '../../server/hub.ts';

/** Server-side services handed to route loaders by the Hono app. */
export interface ServerRuntime {
  getDocument(ref: string): Promise<PrompterDocument>;
}

type RuntimeContext = RouterContext<ServerRuntime | null>;

/**
 * The route modules are bundled by Vite while the Hono server is compiled
 * separately, so this file is loaded twice. Router contexts are matched by
 * identity, so both copies must share one context object.
 */
const globalKey = Symbol.for('prompter.serverRuntimeContext');
const store = globalThis as typeof globalThis & { [globalKey]?: RuntimeContext };

function sharedContext(): RuntimeContext {
  const existing = store[globalKey];
  if (existing) return existing;
  const created = createContext<ServerRuntime | null>(null);
  store[globalKey] = created;
  return created;
}

export const serverRuntimeContext: RuntimeContext = sharedContext();
