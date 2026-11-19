// Must stay the first import: configures Zod before any schema is built.
import "./lib/zod-config";
import { hashKey, MutationCache, QueryCache, QueryClient } from "@tanstack/solid-query";
import { createRouter } from "@tanstack/solid-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/solid-router-ssr-query";
import { currentCspNonce } from "@trespass/shared/csp-nonce";
import { goToLogin, isSignedOutError } from "@trespass/shared/error-text";
import { sessionQuery } from "./lib/session-query";
import { routeTree } from "./routeTree.gen";

export type RouterContext = { queryClient: QueryClient };

export function getRouter() {
  // One QueryClient per router: per request on the server, one in the browser.
  // A 401 from any server function in the browser means the session is gone
  // (signed out elsewhere, disabled, password reset): go to /login.
  const onError = (err: unknown) => {
    if (typeof window !== "undefined" && isSignedOutError(err)) goToLogin();
  };
  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, err) => !isSignedOutError(err) && count < 1,
      },
    },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient } satisfies RouterContext,
    scrollRestoration: true,
    defaultPreload: "intent",
    // Loaders should read through queryClient.ensureQueryData; Query owns caching.
    defaultPreloadStaleTime: 0,
    // CSP nonce for every inline script during SSR (undefined in the browser and in dev).
    ssr: { nonce: currentCspNonce() },
  });
  // Dehydrates queries fetched during SSR, hydrates them in the browser and
  // wraps the app in <QueryClientProvider>.
  setupRouterSsrQueryIntegration({ router, queryClient });
  if (typeof window !== "undefined") rerunGuardsOnSessionChange(router, queryClient);
  return router;
}

/**
 * The root beforeLoad serves the cached session and refreshes it in the
 * background once stale. When that refresh finds a different user (signed
 * out, disabled, role changed elsewhere), re-run every beforeLoad so the
 * _authed redirect and the role guards see it right away. Structural sharing
 * keeps the data reference stable while nothing changed.
 */
function rerunGuardsOnSessionChange(
  router: { invalidate: () => Promise<void> },
  queryClient: QueryClient,
) {
  const key = sessionQuery().queryKey;
  const hash = hashKey(key);
  let last: unknown = queryClient.getQueryData(key);
  queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryHash !== hash) return;
    // SSR hydration fills the query via "added"/setState, not "success":
    // remember every value, but only a fetched change re-runs the guards.
    if (event.type !== "added" && event.type !== "updated") return;
    const data = event.query.state.data;
    if (data === undefined) return;
    const changed = last !== undefined && data !== last;
    last = data;
    if (changed && event.type === "updated" && event.action.type === "success") {
      void router.invalidate();
    }
  });
}

declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
