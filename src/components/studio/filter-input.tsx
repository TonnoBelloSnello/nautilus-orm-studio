"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  NON_CONTAINS_FILTER_OPERATORS,
  findFilterColumn,
  formatFilterInput,
  getFilterOperatorLabel,
  getFilterOperatorSyntax,
  parseFilterInput,
  type FilterOperator,
} from "@/lib/nautilus/filter";
import type { ColumnDefinition } from "@/lib/nautilus/types";

interface FilterInputProps {
  columns: ColumnDefinition[];
  initialFilterText?: string;
  initialFilterColumn?: string;
  initialFilterOperator?: string;
  onSearch: (filterText: string, filterColumn: string | null, filterOperator: string | null) => void;
}

type FilterOptionType =
  | "general"
  | "specific"
  | "column-search"
  | "column-suggestion"
  | "operator-suggestion"
  | "logical-suggestion";

interface FilterOption {
  type: FilterOptionType;
  label: string;
  text: string;
  column: string | null;
  operator: FilterOperator | null;
}

const OPTION_HINT: Partial<Record<FilterOptionType, string>> = {
  "column-suggestion": "Autocomplete column",
  "column-search": "Specific column filtering",
  "logical-suggestion": "Combine query conditions",
};

function matchingColumns(columns: ColumnDefinition[], value: string): ColumnDefinition[] {
  const query = value.toLowerCase();
  return columns.filter(
    (column) =>
      column.name.toLowerCase().startsWith(query)
      || column.label.toLowerCase().startsWith(query),
  );
}

function buildOptions(columns: ColumnDefinition[], inputValue: string): FilterOption[] {
  const parsed = parseFilterInput(inputValue);
  const options: FilterOption[] = [];
  const columnSuggestions = parsed.hasColon ? columns : matchingColumns(columns, parsed.columnName);

  if (!inputValue.trim()) {
    return columns.slice(0, 3).map((column) => ({
      type: "column-suggestion",
      label: `Filter by ${column.label}...`,
      text: "",
      column: column.name,
      operator: null,
    }));
  }

  if (!parsed.hasColon) {
    const exactMatch = columns.find(
      (column) => column.name.toLowerCase() === parsed.columnName.toLowerCase(),
    );

    if (!parsed.columnName.includes(" ")) {
      const suggestedColumns = exactMatch ? [exactMatch] : columnSuggestions.slice(0, 3);
      for (const column of suggestedColumns) {
        options.push({
          type: "column-suggestion",
          label: `Filter by ${column.label}...`,
          text: "",
          column: column.name,
          operator: null,
        });
      }
    }

    options.push({
      type: "general",
      label: `Search all columns for "${parsed.columnName}"`,
      text: parsed.columnName,
      column: null,
      operator: null,
    });

    for (const column of columnSuggestions.slice(0, 3)) {
      if (!parsed.columnName) break;
      options.push({
        type: "column-search",
        label: `Search in ${column.label} for "${parsed.columnName}"`,
        text: parsed.columnName,
        column: column.name,
        operator: "contains",
      });
    }
  } else {
    const column = columns.find(
      (candidate) => candidate.name.toLowerCase() === parsed.columnName.toLowerCase(),
    );

    if (column) {
      options.push({
        type: "specific",
        label: `Where ${column.label} ${getFilterOperatorLabel(parsed.operator)} "${parsed.searchValue}"`,
        text: parsed.searchValue,
        column: column.name,
        operator: parsed.operator,
      });

      if (parsed.rawOperator === ":" && !parsed.searchValue) {
        for (const operator of NON_CONTAINS_FILTER_OPERATORS) {
          options.push({
            type: "operator-suggestion",
            label: `${column.label} ${getFilterOperatorSyntax(operator).slice(1)}`,
            text: getFilterOperatorSyntax(operator),
            column: column.name,
            operator,
          });
        }
      }
    }
  }

  if (inputValue.endsWith(" ") && parsed.hasColon && parsed.searchValue) {
    for (const logical of ["AND", "OR"] as const) {
      options.push({
        type: "logical-suggestion",
        label: `${logical} (${logical === "AND" ? "Match all conditions" : "Match any condition"})`,
        text: logical,
        column: null,
        operator: null,
      });
    }
  }

  return options;
}

export function FilterInput({
  columns,
  initialFilterText = "",
  initialFilterColumn,
  initialFilterOperator,
  onSearch,
}: FilterInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(() =>
    formatFilterInput(columns, initialFilterText, initialFilterColumn, initialFilterOperator),
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const options = useMemo(() => buildOptions(columns, inputValue), [columns, inputValue]);

  useEffect(() => {
    setInputValue(formatFilterInput(columns, initialFilterText, initialFilterColumn, initialFilterOperator));
  }, [columns, initialFilterColumn, initialFilterOperator, initialFilterText]);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(options.length - 1, 0)));
  }, [options.length]);

  useEffect(() => {
    const element = document.getElementById(`filter-option-${selectedIndex}`);
    if (isOpen) {
      element?.scrollIntoView({ block: "nearest" });
    }
  }, [isOpen, selectedIndex]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const submitCurrent = () => {
    setIsOpen(false);
    const parsed = parseFilterInput(inputValue);

    if (parsed.prefix) {
      onSearch(inputValue, null, null);
      return;
    }

    if (!parsed.hasColon) {
      onSearch(inputValue, null, null);
      return;
    }

    onSearch(
      parsed.searchValue,
      findFilterColumn(columns, parsed.columnName)?.name ?? null,
      parsed.operator,
    );
  };

  const selectOption = (option: FilterOption) => {
    const parsed = parseFilterInput(inputValue);

    if (option.type === "column-suggestion") {
      setInputValue(`${parsed.prefix}${option.column}:`);
      setSelectedIndex(0);
      inputRef.current?.focus();
      return;
    }

    if (option.type === "operator-suggestion") {
      setInputValue(`${parsed.prefix}${option.column}${option.text}`);
      setSelectedIndex(0);
      inputRef.current?.focus();
      return;
    }

    if (option.type === "logical-suggestion") {
      setInputValue(`${inputValue.trim()} ${option.text} `);
      setSelectedIndex(0);
      inputRef.current?.focus();
      return;
    }

    const nextValue = option.column
      ? `${parsed.prefix}${option.column}${getFilterOperatorSyntax(option.operator)}${option.text}`
      : `${parsed.prefix}${option.text}`;

    setInputValue(nextValue);
    setIsOpen(false);
    onSearch(
      parsed.prefix ? nextValue : option.text,
      parsed.prefix ? null : option.column,
      parsed.prefix ? null : option.operator,
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!isOpen) {
      if (!["Escape", "Enter"].includes(event.key)) {
        setIsOpen(true);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selectedOption = options[selectedIndex];
      if (selectedOption) {
        selectOption(selectedOption);
      } else {
        submitCurrent();
      }
    } else if (event.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full flex-1">
      <form
        className="flex w-full items-center transition-colors focus-within:bg-zinc-800/50"
        onSubmit={(event) => {
          event.preventDefault();
          if (isOpen && options[selectedIndex]) {
            selectOption(options[selectedIndex]);
          } else {
            submitCurrent();
          }
        }}
      >
        <div className="relative flex w-full items-center px-4 py-1.5 text-zinc-400 focus-within:text-white">
          <svg
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 shrink-0 transition-colors"
          >
            <path
              d="M14.386 14.386L18.5 18.5M16.416 9.208A7.208 7.208 0 112 9.208a7.208 7.208 0 0114.416 0z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={inputValue}
            onChange={(event) => {
              setInputValue(event.target.value);
              setIsOpen(true);
              setSelectedIndex(0);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Filter rows..."
            className="w-full bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
            autoComplete="off"
            spellCheck="false"
          />
          {inputValue ? (
            <button
              type="button"
              onClick={() => {
                setInputValue("");
                onSearch("", null, null);
                inputRef.current?.focus();
              }}
              className="transition-colors hover:text-white"
            >
              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                <path
                  d="M15 5L5 15M5 5L15 15"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}

          {isOpen ? (
            <div className="absolute top-full left-0 z-50 mt-2 w-full overflow-hidden rounded-xl border border-(--line) bg-(--panel-2) shadow-xl">
              {options.length > 0 ? (
                <>
                  <div className="max-h-64 overflow-y-auto p-1">
                    {options.map((option, index) => (
                      <button
                        key={`${option.type}-${option.label}-${index}`}
                        id={`filter-option-${index}`}
                        type="button"
                        onClick={() => selectOption(option)}
                        className={`flex w-full flex-col rounded-lg px-3 py-2 text-left text-sm transition ${
                          selectedIndex === index
                            ? "bg-zinc-800 text-white"
                            : "text-zinc-300 hover:bg-zinc-800/50"
                        }`}
                      >
                        <span>{option.label}</span>
                        {OPTION_HINT[option.type] ? (
                          <span className="mt-0.5 text-[10px] uppercase tracking-widest text-(--muted)">
                            {OPTION_HINT[option.type]}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-(--line) bg-zinc-900 px-3 py-2 text-xs text-(--muted)">
                    Tip: Type <span className="font-mono text-zinc-300">columnName:</span> to narrow search
                  </div>
                </>
              ) : (
                <div className="px-4 py-3 text-sm text-(--muted)">
                  No specific filters matched... Hit Enter to search anyway.
                </div>
              )}
            </div>
          ) : null}
        </div>
      </form>
    </div>
  );
}
