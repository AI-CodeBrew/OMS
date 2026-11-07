"use client";

import { useEffectiveUser } from "../store/authStore";
import { canReadPage, canWritePage } from "../components/layout/moduleNav";

/** A page's access for the signed-in user (backend: core/pages.py keys):
 * { canRead, canWrite }. Store admins, super admin and the Dispatch Hub can
 * do everything; staff follow their role. With Read only, every control
 * that changes something on the page is hidden - the API refuses those
 * anyway. */
export default function usePageAccess(pageKey) {
  const user = useEffectiveUser();
  return { canRead: canReadPage(user, pageKey), canWrite: canWritePage(user, pageKey) };
}
