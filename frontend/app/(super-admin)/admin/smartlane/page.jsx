"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The Smartlane Business console moved under OMS Courier - kept so old
// links and bookmarks still land on it.
export default function SmartlaneRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/oms-courier/smartlane-business");
  }, [router]);
  return null;
}
