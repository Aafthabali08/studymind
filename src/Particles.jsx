import React, { useEffect, useRef } from "react";

/**
 * Pointer-reactive background particles. Runs at 30 fps (the slow drift looks
 * the same at half the work), stops when the tab is hidden or motion is
 * reduced, and only re-lays out when the window size really changes.
 */
export default function Particles({ theme }) {
  const ref = useRef();
  useEffect(() => {
    const canvas = ref.current,
      ctx = canvas.getContext("2d");
    if (!ctx) return;
    let width = 0,
      height = 0,
      points,
      frame,
      last = 0,
      resizeTimer;
    const rgb = theme === "dark" ? "220,220,220" : "25,25,25";
    let pointer = { x: -999, y: -999 };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    function draw(time = 0) {
      if (time && time - last < 32) {
        frame = requestAnimationFrame(draw);
        return;
      }
      last = time;
      ctx.clearRect(0, 0, width, height);
      for (const p of points) {
        // Two physics steps per drawn frame keep the 60 fps feel at 30 fps.
        for (let step = 0; step < 2 && !reduced.matches; step++) {
          const dx = p.x - pointer.x,
            dy = p.y - pointer.y,
            distance = Math.hypot(dx, dy);
          if (distance < 145 && distance > 0) {
            p.vx += (dx / distance) * (1 - distance / 145) * 1.9;
            p.vy += (dy / distance) * (1 - distance / 145) * 1.9;
          }
          p.vx += (p.ox + Math.sin(time * 0.0003 + p.phase) * 15 - p.x) * 0.009;
          p.vy += (p.oy + Math.cos(time * 0.0002 + p.phase) * 18 - p.y) * 0.009;
          p.vx *= 0.91;
          p.vy *= 0.91;
          p.x += p.vx;
          p.y += p.vy;
        }
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size * 1.8);
      }
      if (!reduced.matches && !document.hidden)
        frame = requestAnimationFrame(draw);
    }
    function restart() {
      cancelAnimationFrame(frame);
      draw();
    }
    function resize() {
      // Mobile browsers fire resize while scrolling (address bar); ignore
      // small height changes.
      if (
        points &&
        innerWidth === width &&
        Math.abs(innerHeight - height) < 120
      )
        return;
      width = innerWidth;
      height = innerHeight;
      const d = Math.min(devicePixelRatio, 2);
      canvas.width = width * d;
      canvas.height = height * d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      points = Array.from(
        { length: Math.min(230, Math.floor((width * height) / 4300)) },
        () => {
          const x = Math.random() * width,
            y = Math.random() * height,
            size = Math.random() * 1.7 + 0.5;
          return {
            x,
            y,
            ox: x,
            oy: y,
            vx: 0,
            vy: 0,
            size,
            color: `rgba(${rgb},${(0.1 + size * 0.06).toFixed(3)})`,
            phase: Math.random() * 6.28,
          };
        },
      );
      restart();
    }
    const move = (e) => (pointer = { x: e.clientX, y: e.clientY });
    const leave = () => (pointer = { x: -999, y: -999 });
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 150);
    };
    resize();
    addEventListener("resize", onResize);
    addEventListener("pointermove", move);
    document.addEventListener("pointerleave", leave);
    document.addEventListener("visibilitychange", restart);
    reduced.addEventListener("change", restart);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(resizeTimer);
      removeEventListener("resize", onResize);
      removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", restart);
      reduced.removeEventListener("change", restart);
    };
  }, [theme]);
  return <canvas ref={ref} className="particles" aria-hidden="true" />;
}
