"use client";

import { useEffect, useRef } from "react";

export function SidebarNav({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const key = "nautilus-studio-sidebar-scroll";
    const saved = sessionStorage.getItem(key);
    if (saved) {
      el.scrollTop = parseInt(saved, 10);
    }

    let timeoutId: NodeJS.Timeout;
    const handleScroll = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        sessionStorage.setItem(key, el.scrollTop.toString());
      }, 100);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      clearTimeout(timeoutId);
      el.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <nav ref={ref} className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
      {children}
    </nav>
  );
}
