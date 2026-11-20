import { SELF_HOSTED_PHOTON_URL } from "../../src/geo/photon";

/** True when the self-hosted Photon answers on loopback. Photon is stopped by default (README), so live tests skip when it is not. */
export async function photonIsUp(url = SELF_HOSTED_PHOTON_URL): Promise<boolean> {
  try {
    const r = await fetch(new URL("/status", url), { redirect: "manual", signal: AbortSignal.timeout(1500) });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}

export const SKIP_NOTE = `Photon not reachable at ${SELF_HOSTED_PHOTON_URL}: live Photon tests skipped (start: docker compose --profile geocoder up -d photon)`;
