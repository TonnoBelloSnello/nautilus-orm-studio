"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

function applyWidth(element: HTMLTableCellElement | null, width: number) {
  if (!element) return;
  element.style.width = `${width}px`;
  element.style.minWidth = `${width}px`;
  element.style.maxWidth = `${width}px`;
}

export function ResizableTh({
  children,
  minWidth = 80,
}: {
  children: ReactNode;
  minWidth?: number;
}) {
  const thRef = useRef<HTMLTableCellElement>(null);
  const [width, setWidth] = useState(150);
  const widthRef = useRef(150);
  const cleanupResizeRef = useRef<(() => void) | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      cleanupResizeRef.current?.();
    };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    cleanupResizeRef.current?.();

    const startX = event.clientX;
    const startWidth = thRef.current?.getBoundingClientRect().width ?? widthRef.current;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.max(minWidth, startWidth + moveEvent.clientX - startX);

      if (nextWidth === widthRef.current) {
        return;
      }

      widthRef.current = nextWidth;

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        applyWidth(thRef.current, widthRef.current);
      });
    };

    const stopResize = (commitWidth: boolean) => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      cleanupResizeRef.current = null;
      if (commitWidth) {
        setWidth(widthRef.current);
      }
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
    };

    const finishResize = () => {
      stopResize(true);
    };

    cleanupResizeRef.current = () => {
      stopResize(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  };

  return (
    <th
      ref={thRef}
      className="relative border border-(--line) px-3 py-2 font-medium select-none"
      style={{
        width,
        minWidth: width,
        maxWidth: width,
      }}
    >
      <div className="overflow-hidden whitespace-nowrap">{children}</div>
      <div
        className="absolute top-0 right-0 h-full w-2 cursor-col-resize touch-none hover:bg-white/10"
        onPointerDown={handlePointerDown}
      />
    </th>
  );
}
