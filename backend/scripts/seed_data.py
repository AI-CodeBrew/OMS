"""
# Env vars used by seed_data.py (names only):
#   SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY
"""

import os
import sys

from dotenv import load_dotenv


def main():
    load_dotenv()
    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required", file=sys.stderr)
        sys.exit(1)

    print("[dry-run] Seed script placeholder — implement with domain modules")


if __name__ == "__main__":
    main()
