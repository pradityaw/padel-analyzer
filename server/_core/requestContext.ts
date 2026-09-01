/**
 * Adapter-facing alias. Auth context is the production tRPC context.
 */
export {
  createContext as createRequestContext,
  type Context as RequestContext,
} from "./context.js";
