"""What an order must get right before it may move to Approved - so
everything sitting in Approved is fit to dispatch, and a technical glitch
(a lost payment update, a half-synced address) stops the order here instead
of reaching a courier. services.approve_order runs these; any problem keeps
the order where it is, with the problems as the error.
"""

import re
from decimal import Decimal

PHONE_DIGITS = 11
ADDRESS_MIN_CHARS = 20
# Whether an order's city must be on the super admin's city list (Cities
# page, filled from PostEx's and BarqRaftar's own city lists) to be
# Approved. An order failing only this goes to City Issue instead (see
# services.acknowledge_order).
CHECK_CITY = True


def normalize_phone(raw):
    """Digits only, with Pakistan's +92 / 0092 country code turned back
    into the leading 0 - "+92 305-4094932" -> "03054094932"."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("0092"):
        digits = "0" + digits[4:]
    elif digits.startswith("92") and len(digits) == PHONE_DIGITS + 1:
        digits = "0" + digits[2:]
    return digits


def city_key(name):
    """How cities are compared - case, extra spaces and dots don't matter
    ("  lahore " == "Lahore"), spelling does ("LHR" != "Lahore")."""
    return " ".join((name or "").replace(".", " ").split()).casefold()


def city_problem(city):
    """Why `city` can't be Approved - None when it's on the city list
    (or the check is off). Spelling must match a courier's own; case,
    extra spaces and dots don't matter (see city_key)."""
    from .models import City

    if not CHECK_CITY:
        return None
    city = (city or "").strip()
    if not city:
        return "City is missing"
    if not City.objects.exists():
        return "The city list is empty - add the couriers' cities first"
    if not City.objects.filter(name_key=city_key(city)).exists():
        return f"City {city!r} isn't in the couriers' city list"
    return None


def approval_problems(order, *, include_city=True):
    """Everything wrong with `order` for Approved - an empty list when
    it's good to go. include_city=False leaves out the city check, for
    callers that route a bad city to City Issue instead of refusing."""
    problems = []
    if not (order.customer_name or "").strip():
        problems.append("Customer name is missing")

    phone = normalize_phone(order.customer_phone)
    if not phone:
        problems.append("Phone number is missing")
    elif len(phone) != PHONE_DIGITS:
        problems.append(f"Phone must be {PHONE_DIGITS} digits ({order.customer_phone!r} has {len(phone)})")

    address = (order.address_line1 or "").strip()
    if len(address) < ADDRESS_MIN_CHARS:
        problems.append(f"Address must be at least {ADDRESS_MIN_CHARS} characters (has {len(address)})")

    if include_city:
        problem = city_problem(order.city)
        if problem:
            problems.append(problem)

    prepaid = order.payment_gateway != "cod" or order.payment_status == "paid"
    receivable = order.amount_receivable
    if prepaid and receivable > Decimal("0"):
        problems.append(f"Prepaid order still shows PKR {receivable} receivable")
    return problems
