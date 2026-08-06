"""
# Env vars used by create_tenant.py (names only):
#   SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import os
import sys

from dotenv import load_dotenv


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description="Create an OMS tenant")
    parser.add_argument("--name", required=True, help="Tenant display name")
    parser.add_argument("--slug", required=True, help="URL-safe slug")
    parser.add_argument("--plan", default="starter")
    parser.add_argument("--admin-email", required=True)
    args = parser.parse_args()

    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required", file=sys.stderr)
        sys.exit(1)

    # Full implementation lands with tenants module
    print(
        f"[dry-run] Would create tenant name={args.name} slug={args.slug} "
        f"plan={args.plan} admin={args.admin_email}"
    )


if __name__ == "__main__":
    main()
