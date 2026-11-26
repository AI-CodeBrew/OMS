"""Fix Cities (user, 2026-11-23): the Awaiting Confirmation card's button
that corrects misspelt cities from the address, so they pass the city check
on Approve.

For each order whose city isn't on the couriers' city list (oms.City):

1. Close spellings on the list are found - same letters written differently
   ("Sadiq Bad" / "Sadiqabad"), common short forms ("LHR"), a spelling a
   person already fixed by hand (CitySpelling), near spellings ("Sargodah"
   / "Sargodha", with Pakistani spelling swaps: kh/k, gh/g, q/k, dropped
   vowels, double letters) and longer names that start with it ("Mirpur" ->
   Mirpur (AJK), Mirpur Khas).
2. The address decides between them: a list city written in the address
   (not as a road name - "Sargodha Road" in Faisalabad says nothing) and a
   province word (Punjab, Sindh, KPK, AJK / Azad Kashmir, ...). A city in
   another province than the address names is never chosen - a city name
   can be in two provinces.
3. The result:
   - SURE: fixed straight away (Order.city_fix = "auto"); the status
     doesn't change, the order is approved as normal.
   - LIKELY: one suggestion, one click to use it.
   - UNSURE: two or three choices, a person picks.
   - NOT_FOUND: nothing close - a person types the city.
   - NO_COURIER: a real city no courier serves (Panjgur) - not a spelling
     problem.
   Everything not SURE is marked "check" and waits in the popup's Need
   checking list until a person fixes it.

A person's fix teaches it (CitySpelling): after LEARNED_AFTER identical fixes
the same spelling is fixed by itself. Undo puts the old city back and takes
one off what it learned.
"""

import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field

from django.db import transaction
from django.db.models import F

from .approval_checks import CHECK_CITY, city_key
from .pakistan_provinces import UNKNOWN, province_for_city

logger = logging.getLogger(__name__)

SURE = "sure"
LIKELY = "likely"
UNSURE = "unsure"
NOT_FOUND = "not_found"
NO_COURIER = "no_courier"
OK = "ok"

# Fixed by hand this many times (same spelling -> same city) = fixed by itself.
LEARNED_AFTER = 2
# Spelling scores (0-1): strong is a suggestion worth one click.
STRONG = 0.8
WEAK = 0.7
# Orders one click looks at.
MAX_ORDERS = 2000

# The Awaiting Confirmation card - the only place a city can still change.
CARD_STATUSES = {"new", "pending_cc", "pending_cod", "city_issue", "awaiting_approval"}

# Words that say nothing about which city it is.
_NOISE = {
    "city", "district", "distt", "dist", "tehsil", "teh", "tehseel", "pakistan", "pak", "pk",
    "village", "vill", "the",
}
# A city name followed by one of these is a place in another city
# ("Sargodha Road", "Lahore Adda"), not where the parcel goes.
_ROAD_WORDS = {
    "road", "rd", "chowk", "chok", "chowck", "bypass", "byepass", "adda", "stop", "mor", "more",
    "morr", "highway", "motorway", "interchange", "gate", "phatak", "phattak", "bazar", "bazaar",
    "wala", "wali", "walay",
}
# A province word followed by one of these is a place name, not the province.
_PLACE_WORDS = _ROAD_WORDS | {
    "colony", "town", "society", "university", "uni", "bank", "hotel", "college", "school", "market",
    "plaza", "center", "centre", "house", "block", "park", "hospital", "street", "st", "housing", "scheme",
    "cooperative", "group", "police", "govt", "government", "assembly", "secretariat",
}
# Province words in an address or a city, in words (several words = in a row).
_PROVINCE_WORDS = [
    (("azad", "kashmir"), "Azad Kashmir"),
    (("azad", "jammu"), "Azad Kashmir"),
    (("ajk",), "Azad Kashmir"),
    (("a", "j", "k"), "Azad Kashmir"),
    (("punjab",), "Punjab"),
    (("panjab",), "Punjab"),
    (("sindh",), "Sindh"),
    (("sind",), "Sindh"),
    (("kpk",), "Khyber Pakhtunkhwa"),
    (("k", "p", "k"), "Khyber Pakhtunkhwa"),
    (("nwfp",), "Khyber Pakhtunkhwa"),
    (("pakhtunkhwa",), "Khyber Pakhtunkhwa"),
    (("pakhtoonkhwa",), "Khyber Pakhtunkhwa"),
    (("pakhtunkhawa",), "Khyber Pakhtunkhwa"),
    (("balochistan",), "Balochistan"),
    (("baluchistan",), "Balochistan"),
    (("blochistan",), "Balochistan"),
    (("gilgit", "baltistan"), "Gilgit-Baltistan"),
    (("baltistan",), "Gilgit-Baltistan"),
    (("islamabad", "capital", "territory"), "Islamabad Capital Territory"),
    (("ict",), "Islamabad Capital Territory"),
]
# Short forms (the couriers' own alias lists) -> the city they mean.
_SHORT_FORMS = {
    "isb": "islamabad", "pindi": "rawalpindi", "rwp": "rawalpindi", "khi": "karachi",
    "lhr": "lahore", "lhe": "lahore", "fsd": "faisalabad", "mux": "multan", "pew": "peshawar",
    "hyd": "hyderabad", "qta": "quetta", "skt": "sialkot", "grw": "gujranwala", "ryk": "rahim yar khan",
    "dg khan": "dera ghazi khan", "d g khan": "dera ghazi khan", "dgk": "dera ghazi khan",
    "di khan": "dera ismail khan", "d i khan": "dera ismail khan", "dik": "dera ismail khan",
    "wah cantonment": "wah cantt", "rawalpindi cantt": "rawalpindi", "lahore cantt": "lahore",
}
_SHORT_FORMS_FLAT = {key.replace(" ", ""): city for key, city in _SHORT_FORMS.items()}
# Spelling swaps before comparing sounds ("Shekhupura" / "Sheikhupura").
_SOUND_SWAPS = (("ph", "f"), ("kh", "k"), ("gh", "g"), ("ck", "k"), ("q", "k"), ("ee", "i"), ("oo", "u"),
                ("ou", "u"))


# -- Text ------------------------------------------------------------------

def _words(text):
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def _core_words(text):
    words = [w for w in _words(text) if w not in _NOISE]
    return words or _words(text)


def spelling_key(city):
    """How a typed city is remembered: "  Sargodah city" -> "sargodah"."""
    return " ".join(_core_words(city))[:100]


def _sound(flat):
    """A rough sound of the name: swaps above, vowels and h after the first
    letter dropped, double letters single - "Sargodah" and "Sargodha" both
    "srgd"."""
    if not flat:
        return ""
    for a, b in _SOUND_SWAPS:
        flat = flat.replace(a, b)
    flat = flat[0] + re.sub(r"[aeiouyh]", "", flat[1:])
    return re.sub(r"(.)\1+", r"\1", flat)


def _distance(a, b, limit):
    """Edits between a and b (a swap of two letters counts as one), or
    limit + 1 once it's more than limit."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    before = None
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        best = i
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            value = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if before is not None and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                value = min(value, before[j - 2] + 1)
            cur[j] = value
            best = min(best, value)
        if best > limit:
            return limit + 1
        before, prev = prev, cur
    return prev[-1]


def _spelling_score(typed_flat, typed_sound, city):
    """0-1: how close the typed letters are to the city's."""
    if not typed_flat or not city.flat:
        return 0.0
    if typed_flat == city.flat:
        return 1.0
    longest = max(len(typed_flat), len(city.flat))
    limit = max(1, int(longest * 0.3))
    edits = _distance(typed_flat, city.flat, limit)
    score = 1 - edits / longest if edits <= limit else 0.0
    if len(typed_sound) >= 3 and typed_sound == city.sound:
        score = max(score, 0.9)
    # One wrong letter in a 3-4 letter name is a different name more often
    # than a typo.
    if longest <= 4 and score < 1:
        score = min(score, 0.7)
    return score


def _provinces_in(words):
    """(provinces named in `words`, positions those words take). A province
    word that names a place ("Punjab Colony" in Karachi, "Bank of Punjab")
    isn't counted."""
    found, used = set(), set()
    for phrase, province in _PROVINCE_WORDS:
        size = len(phrase)
        for start in range(len(words) - size + 1):
            if tuple(words[start:start + size]) == phrase:
                used.update(range(start, start + size))
                following = words[start + size] if start + size < len(words) else ""
                before = words[start - 1] if start else ""
                if following in _PLACE_WORDS or before in ("of", "bank"):
                    continue
                found.add(province)
    return found, used


# -- The city list ---------------------------------------------------------

@dataclass
class _City:
    name: str
    key: str
    flat: str
    sound: str
    first: str
    province: str


def _province_of(name, province):
    if province:
        return province
    words = _words(name)
    if "ajk" in words or "azad" in words:
        return "Azad Kashmir"
    guess = province_for_city(name)
    return "" if guess == UNKNOWN else guess


class CityList:
    """The couriers' city list, indexed for one Fix Cities run, plus the
    learned spellings."""

    def __init__(self, rows=None, spellings=None):
        from .models import City, CitySpelling

        if rows is None:
            rows = City.objects.values_list("name", "province")
        if spellings is None:
            spellings = CitySpelling.objects.values_list("typed_key", "city_name", "times")
        self.cities = []
        self.by_key, self.by_flat, self.by_sound = {}, defaultdict(list), defaultdict(list)
        self.by_first, self.by_initial = defaultdict(list), defaultdict(list)
        for name, province in rows:
            words = _words(name)
            if not words:
                continue
            city = _City(
                name=name, key=city_key(name), flat="".join(words), sound=_sound("".join(words)),
                first=words[0], province=_province_of(name, province),
            )
            self.cities.append(city)
            self.by_key[city.key] = city
            self.by_flat[city.flat].append(city)
            self.by_sound[city.sound].append(city)
            self.by_first[city.first].append(city)
            self.by_initial[city.flat[0]].append(city)
            if city.sound[:1] != city.flat[:1]:
                self.by_initial[city.sound[0]].append(city)
        self.learned = defaultdict(dict)
        for typed, city_name, times in spellings:
            self.learned[typed][city_name] = times
        self._spelling_memo = {}

    def listed(self, city):
        """The list's own spelling of `city`, or None when it isn't on it."""
        found = self.by_key.get(city_key(city))
        return found.name if found else None

    def ok(self, city):
        return not CHECK_CITY or (bool((city or "").strip()) and city_key(city) in self.by_key)

    # Candidates from the typed city alone - the same for every order with
    # that city, so worked out once per run.
    def spelling_candidates(self, typed):
        memo_key = " ".join(_words(typed))
        if memo_key not in self._spelling_memo:
            self._spelling_memo[memo_key] = self._spelling_candidates(typed)
        return self._spelling_memo[memo_key]

    def _spelling_candidates(self, typed):
        words = _words(typed)
        _provinces, province_used = _provinces_in(words)
        core = [w for i, w in enumerate(words) if i not in province_used and w not in _NOISE] or words
        found = {}

        def add(city, score, why, kind="spelling"):
            have = found.get(city.name)
            if have is None or score > have["score"]:
                found[city.name] = {"city": city, "score": score, "why": why, "kind": kind}

        variants = {"".join(words), "".join(core)}
        # Short forms however they're written: "fsd", "FSD.", "F.S.D", "F S D".
        short = next((_SHORT_FORMS_FLAT[v] for v in ("".join(core), "".join(words)) if v in _SHORT_FORMS_FLAT), None)
        for flat in variants:
            for city in self.by_flat.get(flat, []):
                add(city, 1.0, "Same name, written differently", "exact")
        if short:
            for city in self.by_flat.get(short.replace(" ", ""), []):
                add(city, 1.0, f"{''.join(core).upper()} is short for {city.name}", "exact")
        # Near spellings.
        for flat in variants:
            if len(flat) < 3:
                continue
            sound = _sound(flat)
            pool = {id(c): c for c in self.by_initial.get(flat[0], []) + self.by_initial.get(sound[:1], [])}
            pool.update({id(c): c for c in self.by_sound.get(sound, [])})
            for city in pool.values():
                score = _spelling_score(flat, sound, city)
                if score >= WEAK:
                    add(city, score, f"Close spelling of {city.name}")
        # Longer names that start with it - "Mirpur" -> Mirpur (AJK), Mirpur Khas.
        if core and len("".join(core)) >= 4:
            for city in self.by_first.get(core[0], []):
                city_words = _words(city.name)
                if city_words[: len(core)] == core and len(city_words) > len(core):
                    add(city, 0.85, f"{city.name} starts with {' '.join(core).title()}", "prefix")
        # A list city inside a longer typed city - "DHA Lahore".
        for name in _phrases_in(core, self.by_flat, min_len=4):
            for city in self.by_flat[name]:
                add(city, 0.85, f"{city.name} is in the city name", "inside")
        # Fixed by hand before - fewer times than makes it automatic, still a
        # strong suggestion (diagnose makes the automatic ones).
        learned = self.learned.get(spelling_key(typed)) or {}
        for city_name, times in learned.items():
            city = self.by_key.get(city_key(city_name))
            if city is not None:
                add(city, 0.95, f"Fixed by hand to {city.name} {'once' if times == 1 else f'{times} times'} before",
                    "learned")
        return found, learned


def _phrases_in(words, by_flat, *, min_len=4, road_check=False):
    """List cities written in `words` (1-4 words in a row, longest first),
    as {flat: [phrase, ...]}. road_check: skip one followed by a road word."""
    hits = defaultdict(list)
    used = [False] * len(words)
    for size in (4, 3, 2, 1):
        for start in range(len(words) - size + 1):
            if any(used[start:start + size]):
                continue
            flat = "".join(words[start:start + size])
            if len(flat) < min_len or flat not in by_flat:
                continue
            for k in range(start, start + size):
                used[k] = True
            following = words[start + size] if start + size < len(words) else ""
            if road_check and following in _ROAD_WORDS:
                continue
            hits[flat].append(" ".join(words[start:start + size]))
    return hits


# -- One order -------------------------------------------------------------

@dataclass
class Diagnosis:
    group: str
    city: str = ""
    note: str = ""
    options: list = field(default_factory=list)
    highlight: list = field(default_factory=list)


def _option(entry, why=None):
    city = entry["city"]
    return {"name": city.name, "province": city.province, "why": why or entry["why"]}


def diagnose(city, address, cities):
    """What Fix Cities makes of one order's `city`, given its `address`
    (both address lines) and the CityList."""
    typed = " ".join((city or "").split())
    if cities.ok(typed):
        return Diagnosis(OK, city=cities.listed(typed) or typed)
    if not cities.cities:
        return Diagnosis(NOT_FOUND, note="The city list is empty - add the couriers' cities first")

    address_words = _words(address)
    typed_words = _words(typed)
    provinces, _used = _provinces_in(address_words + [""] + typed_words)
    province = next(iter(provinces)) if len(provinces) == 1 else ""
    in_address = _phrases_in(address_words, cities.by_flat, min_len=4, road_check=True)
    highlight = sorted({p for phrases in in_address.values() for p in phrases})

    found, learned = cities.spelling_candidates(typed) if typed else ({}, {})
    candidates = {name: dict(entry) for name, entry in found.items()}
    # Cities only the address names - choices when the typed city says nothing.
    for flat in in_address:
        for c in cities.by_flat[flat]:
            candidates.setdefault(c.name, {"city": c, "score": 0.0, "why": "In the address", "kind": "address"})
    for entry in candidates.values():
        c = entry["city"]
        entry["addr"] = c.flat in in_address
        entry["prov"] = bool(province) and c.province == province

    # A city in another province than the address names is never chosen -
    # unless the address writes that city itself.
    dropped = []
    if province:
        for name in list(candidates):
            c = candidates[name]["city"]
            if c.province and c.province != province and not candidates[name]["addr"]:
                dropped.append(name)
                del candidates[name]

    # Fixed by hand to the same city LEARNED_AFTER times (and nothing else
    # as often): fixed by itself.
    if learned:
        best_name, best_times = max(learned.items(), key=lambda kv: kv[1])
        others = sum(t for n, t in learned.items() if n != best_name)
        listed = cities.listed(best_name)
        if listed and best_times >= LEARNED_AFTER and best_times >= 2 * others:
            c = cities.by_key[city_key(listed)]
            if not (province and c.province and c.province != province):
                return Diagnosis(
                    SURE, city=listed, highlight=highlight,
                    note=f"Fixed by hand to {listed} {best_times} times before",
                )

    def rank(entry):
        return (entry["prov"], entry["addr"], entry["score"])

    ranked = sorted(candidates.values(), key=rank, reverse=True)
    exact = [e for e in ranked if e["kind"] == "exact"]
    if len(exact) == 1:
        return Diagnosis(SURE, city=exact[0]["city"].name, note=exact[0]["why"], highlight=highlight)

    strong = sorted((e for e in ranked if e["score"] >= STRONG), key=lambda e: e["score"], reverse=True)
    strong_in_address = [e for e in strong if e["addr"]]
    if len(strong_in_address) == 1:
        top = strong_in_address[0]
        return Diagnosis(
            SURE, city=top["city"].name, highlight=highlight,
            note=f"{top['why']} - and {top['city'].name} is in the address",
        )
    if len(strong_in_address) > 1:
        return Diagnosis(
            UNSURE, highlight=highlight, options=[_option(e) for e in strong_in_address[:3]],
            note="More than one of these is in the address - please choose",
        )

    other_cities_in_address = [
        name for flat in in_address for name in (c.name for c in cities.by_flat[flat])
        if name not in {e["city"].name for e in strong}
    ]
    if len(strong) == 1:
        top = strong[0]
        if top["prov"] and top["score"] >= 0.85 and not other_cities_in_address:
            return Diagnosis(
                SURE, city=top["city"].name, highlight=highlight,
                note=f"{top['why']} - and the address says {province}",
            )
        return Diagnosis(
            LIKELY, city=top["city"].name, highlight=highlight,
            options=[_option(top)] + [_option(e) for e in ranked if e is not top][:2],
            note=top["why"] + (f" (the address also names {', '.join(other_cities_in_address[:2])})"
                               if other_cities_in_address else ""),
        )
    if len(strong) > 1:
        top, second = strong[0], strong[1]
        same_start = top["city"].first == second["city"].first
        if top["score"] - second["score"] >= 0.1 and not same_start:
            return Diagnosis(
                LIKELY, city=top["city"].name, highlight=highlight,
                options=[_option(e) for e in strong[:3]], note=top["why"],
            )
        choices = sorted(strong, key=rank, reverse=True)[:3]
        names = [e["city"].name for e in choices]
        return Diagnosis(
            UNSURE, highlight=highlight, options=[_option(e) for e in choices],
            note=f"Could be {', '.join(names[:-1])} or {names[-1]} - the address doesn't say which",
        )

    # Nothing close in spelling.
    in_addr = [e for e in ranked if e["addr"]]
    if len(in_addr) == 1:
        top = in_addr[0]
        return Diagnosis(
            LIKELY, city=top["city"].name, highlight=highlight, options=[_option(top)],
            note=f"The city doesn't match any name, but {top['city'].name} is in the address",
        )
    if len(in_addr) > 1:
        return Diagnosis(
            UNSURE, highlight=highlight, options=[_option(e) for e in in_addr[:3]],
            note="The address names more than one city - please choose",
        )
    weak = [e for e in ranked if e["score"] >= WEAK]
    if len(weak) == 1:
        return Diagnosis(
            LIKELY, city=weak[0]["city"].name, highlight=highlight, options=[_option(weak[0])],
            note=weak[0]["why"] + " (not a very close spelling)",
        )
    if weak:
        weak.sort(key=lambda e: e["score"], reverse=True)
        return Diagnosis(
            UNSURE, highlight=highlight, options=[_option(e) for e in weak[:3]],
            note="A few names are close - please choose",
        )
    if not typed:
        return Diagnosis(NOT_FOUND, highlight=highlight, note="City is missing - pick it from the address")
    if _known_city_name(typed):
        return Diagnosis(
            NO_COURIER, highlight=highlight,
            note=f"{typed} is a real city but no courier on the list serves it",
        )
    note = "No city on the list is close to this"
    if dropped:
        note += f" ({', '.join(dropped[:2])} left out - the address says {province})"
    return Diagnosis(NOT_FOUND, highlight=highlight, note=note)


def _known_city_name(typed):
    """True when the built-in province list knows `typed` as a whole name
    (not just a word in it)."""
    from .pakistan_provinces import _ALIASES, _LOOKUP, _key

    # Not a short form ("fsd") - those aren't city names.
    key = _key(typed)
    return key in _LOOKUP and key not in _ALIASES and key not in _SHORT_FORMS_FLAT


# -- Changing orders -------------------------------------------------------

def order_address(order):
    return " ".join(p for p in (order.address_line1, order.address_line2) if (p or "").strip())


def row(order, diagnosis=None):
    """One order as the Fix Cities popup shows it."""
    data = {
        "order_id": str(order.id),
        "order_number": order.order_number,
        "oms_id": order.supabase_order_no,
        "store": getattr(order.organization, "name", "") if order.organization_id else "",
        "customer_name": order.customer_name,
        "status": order.status,
        "city": order.city,
        "city_before_fix": order.city_before_fix,
        "city_fix": order.city_fix,
        "city_fix_note": order.city_fix_note,
        "address": order_address(order),
        # Shown line by line in the popup, to check the address before
        # picking a city (user, 2026-11-25).
        "address_line1": order.address_line1,
        "address_line2": order.address_line2,
        "postal_code": order.postal_code,
    }
    if diagnosis is not None:
        data.update({
            "group": diagnosis.group,
            "suggestion": diagnosis.city,
            "options": diagnosis.options,
            "highlight": diagnosis.highlight,
            "note": diagnosis.note,
        })
    return data


def _history(order, note, actor_user_id):
    from .models import OrderStatusEvent

    OrderStatusEvent.objects.create(
        organization_id=order.organization_id, order=order, from_status=order.status,
        to_status=order.status, note=note[:255], actor_user_id=actor_user_id,
    )


def _publish(order):
    from core.events import publish_event

    publish_event(
        "order.updated",
        {"organization_id": str(order.organization_id), "order_id": str(order.id),
         "order_number": order.order_number, "source": "city_fix"},
    )


def apply_fix(order, new_city, *, mode, note, actor_user_id=None):
    """Sets the order's city to `new_city` (already the list's spelling) and
    marks it fixed. The status doesn't change."""
    from .models import Order

    old = order.city
    with transaction.atomic():
        order.city = new_city
        if not order.city_before_fix:
            order.city_before_fix = old[:100]
        order.city_fix = mode
        order.city_fix_note = note[:255]
        order.save(update_fields=["city", "city_before_fix", "city_fix", "city_fix_note", "updated_at"])
        how = "automatically" if mode == Order.CITY_FIX_AUTO else "by hand"
        _history(order, f"City fixed {how}: {old or '(blank)'} -> {new_city} ({note})", actor_user_id)
    _publish(order)
    return order


def mark_check(order, note):
    from .models import Order

    if order.city_fix == Order.CITY_FIX_CHECK and order.city_fix_note == note[:255]:
        return order
    order.city_fix = Order.CITY_FIX_CHECK
    order.city_fix_note = note[:255]
    order.save(update_fields=["city_fix", "city_fix_note", "updated_at"])
    _publish(order)
    return order


def clear_check(order):
    if order.city_fix:
        from .models import Order

        if order.city_fix == Order.CITY_FIX_CHECK:
            order.city_fix = ""
            order.city_fix_note = ""
            order.save(update_fields=["city_fix", "city_fix_note", "updated_at"])
            _publish(order)
    return order


def learn(typed, city_name, delta=1):
    """Counts one fix (or with delta=-1, one undo) of `typed` -> `city_name`."""
    from .models import CitySpelling

    key = spelling_key(typed)
    if not key or not city_name:
        return
    if delta > 0:
        spelling, created = CitySpelling.objects.get_or_create(
            typed_key=key, city_name=city_name, defaults={"times": delta}
        )
        if not created:
            CitySpelling.objects.filter(pk=spelling.pk).update(times=F("times") + delta)
        return
    for spelling in CitySpelling.objects.filter(typed_key=key, city_name=city_name):
        if spelling.times + delta <= 0:
            spelling.delete()
        else:
            CitySpelling.objects.filter(pk=spelling.pk).update(times=F("times") + delta)


def run(orders, *, actor_user_id=None, cities=None):
    """The Fix Cities button over `orders` (Awaiting Confirmation ones only).
    Returns {summary, fixed, check}."""
    cities = cities or CityList()
    fixed, check = [], []
    already_ok = skipped = 0
    for order in orders:
        if order.status not in CARD_STATUSES:
            skipped += 1
            continue
        try:
            diagnosis = diagnose(order.city, order_address(order), cities)
            if diagnosis.group == OK:
                clear_check(order)
                already_ok += 1
            elif diagnosis.group == SURE:
                apply_fix(order, diagnosis.city, mode="auto", note=diagnosis.note, actor_user_id=actor_user_id)
                fixed.append(row(order, diagnosis))
            else:
                mark_check(order, diagnosis.note)
                check.append(row(order, diagnosis))
        except Exception:  # noqa: BLE001 - one bad order mustn't stop the rest
            logger.exception("fix cities: order %s failed", order.order_number)
            skipped += 1
    return {
        "summary": {
            "checked": len(fixed) + len(check) + already_ok,
            "fixed": len(fixed),
            "need_check": len(check),
            "already_ok": already_ok,
            "skipped": skipped,
        },
        "fixed": fixed,
        "check": check,
    }


def as_suggestion(diagnosis, cities):
    """A SURE answer for an order a person is already looking at (Need
    checking, or just undone): shown as a one-click suggestion instead of
    being applied again behind their back."""
    if diagnosis.group == SURE:
        diagnosis.group = LIKELY
        city = cities.by_key.get(city_key(diagnosis.city))
        diagnosis.options = diagnosis.options or [
            {"name": diagnosis.city, "province": city.province if city else "", "why": diagnosis.note}
        ]
    return diagnosis


def review(orders, *, cities=None):
    """The popup reopened: orders still marked "check" (with fresh
    suggestions - the list may have changed) and the fixed ones (for Undo)."""
    cities = cities or CityList()
    fixed, check = [], []
    for order in orders:
        if order.city_fix == "check":
            diagnosis = diagnose(order.city, order_address(order), cities)
            if diagnosis.group == OK:
                clear_check(order)
                continue
            # Learned since, or the city list grew - suggested, still a click.
            check.append(row(order, as_suggestion(diagnosis, cities)))
        elif order.city_fix in ("auto", "manual"):
            fixed.append(row(order))
    return {"fixed": fixed, "check": check}


def fix_by_hand(order, city, *, actor_user_id=None, cities=None, learned=None):
    """A person's pick in the popup. Returns the order; raises ValueError
    with the reason when it can't be done. `learned`: a set shared across
    one request so "Use all suggested" counts each spelling once."""
    cities = cities or CityList()
    if order.status not in CARD_STATUSES:
        raise ValueError("Only orders in Awaiting Confirmation can be changed")
    listed = cities.listed(city)
    if not listed:
        raise ValueError(f"{city!r} isn't on the couriers' city list")
    old = order.city
    if listed == old and order.city_fix != "check":
        return order
    typed = order.city_before_fix or old
    # Picked again differently: the earlier pick no longer counts.
    earlier = cities.listed(old)
    if order.city_fix == "manual" and earlier and earlier != listed:
        learn(typed, earlier, delta=-1)
    # Only a misspelling teaches anything - not one good city for another.
    if typed and not cities.ok(typed):
        pair = (spelling_key(typed), listed)
        if learned is None or pair not in learned:
            learn(typed, listed)
            if learned is not None:
                learned.add(pair)
    return apply_fix(order, listed, mode="manual", note="Checked by hand", actor_user_id=actor_user_id)


def undo(order, *, actor_user_id=None):
    """Puts the city back as it was before the fix; the order goes back to
    Need checking."""
    if order.status not in CARD_STATUSES:
        raise ValueError("Only orders in Awaiting Confirmation can be changed")
    if order.city_fix not in ("auto", "manual") or not order.city_before_fix:
        raise ValueError("This order's city wasn't fixed by Fix Cities")
    fixed_to, back_to = order.city, order.city_before_fix
    with transaction.atomic():
        learn(back_to, fixed_to, delta=-1)
        order.city = back_to
        order.city_before_fix = ""
        order.city_fix = "check"
        order.city_fix_note = f"Fix undone (was changed to {fixed_to})"[:255]
        order.save(update_fields=["city", "city_before_fix", "city_fix", "city_fix_note", "updated_at"])
        _history(order, f"City fix undone: {fixed_to} -> {back_to}", actor_user_id)
    _publish(order)
    return order


def after_city_edit(order, old_city, *, actor_user_id=None):
    """Edit (or Resolve City Issue) changed the city by hand: a misspelt
    city corrected to a list city counts as a fix by hand (badge + learned);
    an order waiting in Need checking leaves it once its city is good."""
    new_city = order.city
    if (old_city or "") == (new_city or ""):
        return
    try:
        cities = CityList()
        if not cities.ok(new_city):
            # Edited to a city that isn't on the list - the "fixed" badge
            # would no longer be true.
            if order.city_fix in ("auto", "manual"):
                order.city_fix = "check"
                order.city_fix_note = "Changed by hand to a city that isn't on the list"
                order.save(update_fields=["city_fix", "city_fix_note", "updated_at"])
            return
        listed = cities.listed(new_city) or new_city
        if order.city_fix in ("auto", "manual") and order.city_before_fix:
            # Changing a fix: what the original spelling means moves too.
            if order.city_fix == "manual":
                learn(order.city_before_fix, cities.listed(old_city) or old_city, delta=-1)
            if not cities.ok(order.city_before_fix):
                learn(order.city_before_fix, listed)
        elif not cities.ok(old_city):
            learn(old_city, listed)
            order.city_before_fix = (old_city or "")[:100]
        else:
            if order.city_fix == "check":
                clear_check(order)
            return
        order.city_fix = "manual"
        order.city_fix_note = "Changed by hand (Edit)"
        order.save(update_fields=["city_before_fix", "city_fix", "city_fix_note", "updated_at"])
    except Exception:  # noqa: BLE001 - never fails the edit itself
        logger.exception("city fix bookkeeping failed for %s", order.order_number)
