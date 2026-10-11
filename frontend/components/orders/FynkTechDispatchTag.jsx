// Marks an order booked through FynkTech's own courier account - by the
// Dispatch Hub, or by the store itself through OMS Courier
// (order.dispatched_by_fynktech) - so a store that also ships some orders
// with its own courier can tell the two apart at a glance.
// `onDark` is for the brand-coloured strip in the order detail panel.
export default function FynkTechDispatchTag({ onDark = false }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        onDark ? "bg-white text-brand-800" : "bg-brand-800 text-white"
      }`}
      title="Booked through FynkTech's courier account (OMS Courier)"
    >
      by FynkTech
    </span>
  );
}
