import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

export const SCHEMA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/api/preview-manifest.schema.json");
export const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

/** Returns the list of schema errors (empty when valid). */
export function manifestErrors(m: unknown): string[] {
  return validate(m) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`);
}
