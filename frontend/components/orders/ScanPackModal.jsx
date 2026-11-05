"use client";

import { useRef } from "react";
import Modal from "../shared/Modal";
import ScanPanel from "../wms/ScanPanel";
import { SCAN_DESKS } from "../../lib/scanDesks";

// Assigning Courier's Scan: each parcel's barcode turns its tag from To Be
// Packed to Packed (backend: oms.services.scan_pack). The list behind it
// refreshes once the modal is closed, if anything was packed - open pages
// get each change over the WebSocket meanwhile.
export default function ScanPackModal({ open, onClose, onPacked }) {
  const packedAny = useRef(false);

  if (!open) return null;

  function close() {
    if (packedAny.current) onPacked?.();
    packedAny.current = false;
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title="Scan to pack">
      <ScanPanel
        {...SCAN_DESKS.pack}
        onAfterSuccess={() => {
          packedAny.current = true;
        }}
      />
    </Modal>
  );
}
