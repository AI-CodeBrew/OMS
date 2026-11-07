import { redirect } from "next/navigation";

// The IMS tab opens on Inventory.
export default function ImsHomeRedirect() {
  redirect("/ims/inventory");
}
