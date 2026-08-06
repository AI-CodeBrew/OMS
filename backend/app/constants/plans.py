# Tenant plan limits and pricing (extend as billing lands)

PLAN_FREE = "free"
PLAN_STARTER = "starter"
PLAN_GROWTH = "growth"
PLAN_ENTERPRISE = "enterprise"

PLAN_LIMITS = {
    PLAN_FREE: {
        "max_orders_per_month": 100,
        "max_team_members": 2,
        "max_warehouses": 1,
    },
    PLAN_STARTER: {
        "max_orders_per_month": 1000,
        "max_team_members": 5,
        "max_warehouses": 2,
    },
    PLAN_GROWTH: {
        "max_orders_per_month": 10000,
        "max_team_members": 20,
        "max_warehouses": 5,
    },
    PLAN_ENTERPRISE: {
        "max_orders_per_month": None,
        "max_team_members": None,
        "max_warehouses": None,
    },
}
