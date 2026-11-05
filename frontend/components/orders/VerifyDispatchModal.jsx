"use client";

import Modal from "../shared/Modal";
import ScanPanel from "../wms/ScanPanel";
import { SCAN_DESKS } from "../../lib/scanDesks";

export default function VerifyDispatchModal({ open, onClose, onDispatched }) {
  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Verify and Dispatch">
      <ScanPanel {...SCAN_DESKS.dispatch} onAfterSuccess={onDispatched} autoFocusInput />
    </Modal>
  );
}
