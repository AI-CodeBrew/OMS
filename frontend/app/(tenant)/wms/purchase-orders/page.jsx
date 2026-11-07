import { redirect } from "next/navigation";

// Purchase Orders moved to the IMS module - old links and bookmarks land there.
export default function WmsPurchaseOrdersRedirect() {
  redirect("/ims/purchase-orders");
}
