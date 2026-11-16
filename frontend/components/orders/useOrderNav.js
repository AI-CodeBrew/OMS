import { useMemo, useRef } from "react";

// The order details panel's previous / next arrows: steps through `orders`
// (the list the panel was opened from, as it shows now) by moving
// `openId`. Returns {onPrev, onNext, position} for OrderDetailPanel - the
// handlers are null at either end, so that arrow is greyed out.
//
// An order that has just left the list (approved, cancelled... - the list
// reloads without it) keeps its place: › goes to the order that now sits
// where it was - the next one still waiting - and ‹ to the one before.
export default function useOrderNav(orders, openId, setOpenId) {
  const lastPlace = useRef({ id: null, index: -1 });
  return useMemo(() => {
    const list = orders || [];
    let index = openId ? list.findIndex((o) => o.id === openId) : -1;
    if (index >= 0) {
      lastPlace.current = { id: openId, index };
    } else if (openId && lastPlace.current.id === openId && lastPlace.current.index >= 0) {
      // Gone from the list: the orders after it moved up one place.
      const at = lastPlace.current.index;
      return {
        onPrev: at > 0 && list[at - 1] ? () => setOpenId(list[at - 1].id) : null,
        onNext: list[at] ? () => setOpenId(list[at].id) : null,
        position: list.length ? `left this list · ${list.length} remaining` : "left this list",
      };
    }
    if (index < 0) return { onPrev: null, onNext: null, position: "" };
    return {
      onPrev: index > 0 ? () => setOpenId(list[index - 1].id) : null,
      onNext: index < list.length - 1 ? () => setOpenId(list[index + 1].id) : null,
      position: `${index + 1} of ${list.length}`,
    };
  }, [orders, openId, setOpenId]);
}
