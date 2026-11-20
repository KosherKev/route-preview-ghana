// Usage: npm run serve   (PORT env, default 8787; binds 127.0.0.1 only)
import { createApproachServer, listenLoopback } from "../src/routing/server";

const port = Number(process.env.PORT ?? 8787);
const server = createApproachServer();
await listenLoopback(server, port);
console.log(`approach service on http://127.0.0.1:${port} (POST /approach, GET /health)`);
