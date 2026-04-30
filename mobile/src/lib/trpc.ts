import { createTRPCUntypedClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { API_BASE_URL } from "./config";

export const trpc = createTRPCUntypedClient({
  links: [
    httpBatchLink({
      url: `${API_BASE_URL}/api/trpc`,
      transformer: superjson,
    }),
  ],
});
