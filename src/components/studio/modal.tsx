"use client";

import { ReactNode, useEffect } from "react";

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
        aria-label="Close modal"
      />
      <div
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-(--line) bg-(--panel) shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_18px_80px_rgba(0,0,0,0.45)] animate-slide-in-up"
        role="dialog"
        aria-modal="true"
      >
        <div className="p-6">
          <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
          {description && <p className="mt-2 text-sm text-(--muted)">{description}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}