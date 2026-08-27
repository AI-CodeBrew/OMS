import { redirect } from "next/navigation";

export default function SystemHealthRedirect() {
  redirect("/admin/organizations");
}
