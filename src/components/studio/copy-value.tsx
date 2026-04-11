"use client";

import { useState } from "react";

import { formatCell } from "@/lib/nautilus/presentation";

export function CopyValue({
  value,
  className = "",
}: {
  value: unknown;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const isNullish = value == null;
  const text = formatCell(value);

  async function handleCopy() {
    if (isNullish || !text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (isNullish) {
    return (
      <span className={`block max-w-full truncate text-left italic text-zinc-500 ${className}`}>
        NULL
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`block w-full min-h-[1.5em] max-w-full truncate text-left transition hover:text-white ${className}`}
      title={copied ? "Copied" : text || "Empty"}
    >
      {text || " "}
    </button>
  );
}
