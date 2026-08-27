import { notFound } from "next/navigation";

/** Target of IP-blocked rewrites — renders the same as a missing page. */
export default function NotFoundAdminPage() {
  notFound();
}
