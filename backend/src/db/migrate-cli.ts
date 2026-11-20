import pg from "pg";
import { dbConfig, loadEnv } from "../config";
import { applyMigrations } from "./migrate";

loadEnv();
const client = new pg.Client(dbConfig());
await client.connect();
try {
  const applied = await applyMigrations(client);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "no pending migrations");
} finally {
  await client.end();
}
