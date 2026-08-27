import { redirect } from "next/navigation";

export default function TenantsRedirect() {
  redirect("/admin/organizations");
}
