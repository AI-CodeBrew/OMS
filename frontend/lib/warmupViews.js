import ordersService from "../services/ordersService";
import {
  applyWarmup,
  dashboardPresetKeys,
  getWarmupGeneration,
} from "./viewCache";

let inflight = null;
let inflightKey = null;

export async function warmupViews({ pageSize = 10, dashKeys } = {}) {
  const keys = dashKeys || dashboardPresetKeys();
  const cacheKey = `${pageSize}|${keys.join(",")}|${getWarmupGeneration()}`;
  if (inflight && inflightKey === cacheKey) return inflight;
  const myGen = getWarmupGeneration();
  inflightKey = cacheKey;
  inflight = (async () => {
    try {
      const payload = await ordersService.warmup({ pageSize, dashKeys: keys });
      if (myGen === getWarmupGeneration()) applyWarmup(payload, pageSize);
      return payload;
    } finally {
      if (inflightKey === cacheKey) {
        inflight = null;
        inflightKey = null;
      }
    }
  })();
  return inflight;
}


// Fire-and-forget variant. warmupViews() fetches all 17 status tabs in one
// request - ~51 sequential queries on the backend, several seconds when
// Redis is cold - so awaiting it before first paint is what made the first
// screen after login feel dead. Callers now render the tab the user is
// actually looking at, then call this to fill the rest in the background:
// by the time they click another tab it is usually already warm, and if it
// is not, that tab just loads normally.
//
// Errors are swallowed on purpose. This is an optimisation, and a failed
// warmup must never surface as an error on a page that already rendered
// its data successfully.
export function warmupViewsInBackground(opts) {
  warmupViews(opts).catch(() => {});
}
