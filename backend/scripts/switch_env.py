"""Swap backend/.env.backend for one of the saved profiles.

Usage: python scripts/switch_env.py <testing|live>

Only affects local runs - Fly reads its own secrets, never this file.
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PROFILES = {
    "testing": ".env.backend.testing",
    "live": ".env.backend.live",
}

profile = sys.argv[1] if len(sys.argv) > 1 else ""
if profile not in PROFILES:
    sys.exit("Usage: python scripts/switch_env.py <testing|live>")

source = ROOT / PROFILES[profile]
if not source.exists():
    sys.exit(f"Missing profile file: {source}")

shutil.copyfile(source, ROOT / ".env.backend")
print(f'.env.backend now set to the "{profile}" profile ({PROFILES[profile]}).')
