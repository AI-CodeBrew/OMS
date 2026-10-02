"use client";

import { useCallback, useRef, useState } from "react";
import useBankDetailsStore from "../store/bankDetailsStore";

/** Wrap any "connect an integration" / "create a store" action so it
 * pauses for a Bank details form the first time, then never again once
 * the store has saved one.
 *
 * const { requireBankDetails, modalProps } = useBankDetailsGate();
 * <BankDetailsModal {...modalProps} />
 * <Button onClick={() => requireBankDetails(() => doTheRealThing())}>
 */
export function useBankDetailsGate() {
  const [open, setOpen] = useState(false);
  const pendingRef = useRef(null);
  const ensureLoaded = useBankDetailsStore((s) => s.ensureLoaded);
  const setDetails = useBankDetailsStore((s) => s.setDetails);

  const requireBankDetails = useCallback(
    async (next) => {
      const details = await ensureLoaded();
      if (details) {
        next();
        return;
      }
      pendingRef.current = next;
      setOpen(true);
    },
    [ensureLoaded]
  );

  const onSaved = useCallback(
    (details) => {
      setDetails(details);
      setOpen(false);
      const next = pendingRef.current;
      pendingRef.current = null;
      next?.();
    },
    [setDetails]
  );

  const onClose = useCallback(() => {
    pendingRef.current = null;
    setOpen(false);
  }, []);

  return {
    requireBankDetails,
    modalProps: { open, onClose, onSaved },
  };
}

export default useBankDetailsGate;
