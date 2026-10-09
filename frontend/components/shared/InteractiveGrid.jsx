"use client";

import { useEffect, useRef } from "react";

// Square grid background drawn on a canvas. Lines BEHIND the moving cursor
// (the side it came from) are pulled toward it and light up, leaving a
// stretched trail; lines in front stay put. They spring back when it stops.
export default function InteractiveGrid({
  base = "100,116,139",
  glow = "37,99,235",
  baseAlpha = 0.12,
  glowAlpha = 0.7,
  size = 40,
  radius = 200,
  pull = 0.45,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return undefined;
    const ctx = canvas.getContext("2d");
    const step = 8; // segment length used to bend the lines smoothly

    let w = 0;
    let h = 0;
    let raf = 0;
    const target = { x: 0, y: 0, on: false };
    const pos = { x: 0, y: 0, k: 0 };
    const vel = { x: 0, y: 0 }; // smoothed pointer velocity
    let dirX = 0;
    let dirY = 0;
    let moveS = 0; // 0..1, how fast the pointer is moving

    // Point of the grid after being pulled toward the cursor.
    const warp = (x, y, out) => {
      const dx = pos.x - x;
      const dy = pos.y - y;
      const d = Math.hypot(dx, dy);
      if (moveS < 0.001 || pos.k < 0.001 || d >= radius) {
        out.x = x;
        out.y = y;
        out.t = 0;
        return;
      }
      // Only points behind the direction of travel are pulled.
      const behind = (dx * dirX + dy * dirY) / d;
      const b = behind > 0 ? behind : 0;
      if (b === 0) {
        out.x = x;
        out.y = y;
        out.t = 0;
        return;
      }
      const t = 1 - d / radius;
      const f = t * t * pull * pos.k * moveS * b;
      out.x = x + dx * f;
      out.y = y + dy * f;
      out.t = t * pos.k * moveS * b;
    };

    const p0 = { x: 0, y: 0, t: 0 };
    const p1 = { x: 0, y: 0, t: 0 };

    const strokeLine = (horizontal, c) => {
      const len = horizontal ? w : h;
      const gl = [];
      ctx.beginPath();
      for (let s = 0; s <= len; s += step) {
        const x = horizontal ? s : c;
        const y = horizontal ? c : s;
        warp(x, y, p1);
        if (s === 0) ctx.moveTo(p1.x, p1.y);
        else {
          ctx.lineTo(p1.x, p1.y);
          if (p1.t > 0.02) gl.push(p0.x, p0.y, p1.x, p1.y, (p0.t + p1.t) / 2);
        }
        p0.x = p1.x;
        p0.y = p1.y;
        p0.t = p1.t;
      }
      ctx.strokeStyle = `rgba(${base},${baseAlpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      // Highlight the part of the line near the cursor.
      for (let i = 0; i < gl.length; i += 5) {
        ctx.beginPath();
        ctx.moveTo(gl[i], gl[i + 1]);
        ctx.lineTo(gl[i + 2], gl[i + 3]);
        ctx.strokeStyle = `rgba(${glow},${gl[i + 4] * glowAlpha})`;
        ctx.stroke();
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (let x = 0; x <= w + size; x += size) strokeLine(false, x);
      for (let y = 0; y <= h + size; y += size) strokeLine(true, y);
    };

    const tick = () => {
      pos.x += (target.x - pos.x) * 0.2;
      pos.y += (target.y - pos.y) * 0.2;
      pos.k += ((target.on ? 1 : 0) - pos.k) * 0.1;
      vel.x *= 0.9;
      vel.y *= 0.9;
      const sp = Math.hypot(vel.x, vel.y);
      if (sp > 0.05) {
        dirX = vel.x / sp;
        dirY = vel.y / sp;
      }
      moveS = Math.min(1, sp / 12);
      draw();
      raf = (target.on && sp > 0.05) || pos.k > 0.005 ? requestAnimationFrame(tick) : 0;
      if (!raf) {
        pos.k = 0;
        draw();
      }
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const resize = () => {
      const r = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const onMove = (e) => {
      const r = parent.getBoundingClientRect();
      target.x = e.clientX - r.left;
      target.y = e.clientY - r.top;
      if (!target.on) {
        pos.x = target.x;
        pos.y = target.y;
      } else {
        vel.x = vel.x * 0.6 + (e.movementX || 0) * 0.4 * 2;
        vel.y = vel.y * 0.6 + (e.movementY || 0) * 0.4 * 2;
      }
      target.on = true;
      kick();
    };
    const onLeave = () => {
      target.on = false;
      kick();
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    parent.addEventListener("mousemove", onMove);
    parent.addEventListener("mouseleave", onLeave);
    return () => {
      ro.disconnect();
      parent.removeEventListener("mousemove", onMove);
      parent.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, [base, glow, baseAlpha, glowAlpha, size, radius, pull]);

  const fade = "radial-gradient(ellipse at center, black 35%, transparent 90%)";
  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ maskImage: fade, WebkitMaskImage: fade }}
    />
  );
}
