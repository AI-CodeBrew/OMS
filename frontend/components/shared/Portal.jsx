"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Draws `children` straight into <body>. Every page sits inside a sticky
// <main> (app/(tenant)/layout.jsx), and a sticky element is its own stacking
// layer - a popup drawn inside it, whatever its z-index, stayed under the top
// bar (z-40), which covered the popup's top (user, 2026-11-23). From <body>
// a popup's z-index counts against the top bar's.
// Renders nothing until mounted - there is no <body> during server render.
export default function Portal({ children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}
