/**
 * Server-only re-exports for gateway auth helpers.
 * Middleware lives in cli-gateway-middleware.ts (needs a client hook).
 */
export {
  CliAuthError,
  assertGatewayCallerAuthorized,
  bearerFromHeaders,
  cliAuthorized,
  expectedCliToken,
  gatewayBindIsLoopback,
  tokensEqual,
} from "./cli-auth";

/** Prefer `./cli-gateway-middleware` so the client Authorization hook is included. */
export { cliGatewayMiddleware } from "./cli-gateway-middleware";
