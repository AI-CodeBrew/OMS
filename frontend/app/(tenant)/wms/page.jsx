import { redirect } from "next/navigation";

// Inventory moved to the IMS module - old links and bookmarks land there.
export default function WmsHomeRedirect() {
  redirect("/ims/inventory");
}
