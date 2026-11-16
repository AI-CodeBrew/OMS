import { useMemo } from "react";

// The order details panel's previous / next arrows: steps through `orders`
// (the list the panel was opened from, as it shows now) by moving
// `openId`. Returns {onPrev, onNext, position} for OrderDetailPanel - the
// handlers are null at either end, so that arrow is greyed out.
export default function useOrderNav(orders, openId, setOpenId) {
  return useMemo(() => {
    const list = orders || [];
    const index = openId ? list.findIndex((o) => o.id === openId) : -1;
    if (index < 0) return { onPrev: null, onNext: null, position: "" };
    return {
      onPrev: index > 0 ? () => setOpenId(list[index - 1].id) : null,
      onNext: index < list.length - 1 ? () => setOpenId(list[index + 1].id) : null,
      position: `${index + 1} of ${list.length}`,
    };
  }, [orders, openId, setOpenId]);
}
