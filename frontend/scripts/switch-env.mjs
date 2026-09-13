import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const profile = process.argv[2];

const profiles = {
  local: ".env.local.local-backends",
  live: ".env.local.live-backends",
};

if (!profiles[profile]) {
  console.error(`Usage: node scripts/switch-env.mjs <local|live>`);
  process.exit(1);
}

const source = join(root, profiles[profile]);
const target = join(root, ".env.local");

if (!existsSync(source)) {
  console.error(`Missing profile file: ${source}`);
  process.exit(1);
}

copyFileSync(source, target);
console.log(`.env.local now set to the "${profile}" backend profile (${profiles[profile]}).`);
