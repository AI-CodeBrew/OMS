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
