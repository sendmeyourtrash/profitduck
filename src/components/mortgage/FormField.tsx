"use client";

/**
 * Accessible labeled input for the mortgage tool forms.
 *
 * - Uses a real <label htmlFor> pairing for screen readers
 * - Supports prefix ($) and suffix (%, mo, yr)
 * - Helper text and errors wired up via aria-describedby
 * - Number inputs get inputMode="decimal" + spinbutton-friendly step
 * - Keyboard focus ring is visible
 */

import { useId, type ReactNode } from "react";

interface BaseProps {
  label: string;
  helperText?: string;
  error?: string;
  prefix?: string;
  suffix?: string;
  required?: boolean;
  tooltip?: string;
}

interface NumberFieldProps extends BaseProps {
  type?: "number";
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
}

interface TextFieldProps extends BaseProps {
  type: "text";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

interface SelectFieldProps extends BaseProps {
  type: "select";
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}

interface CheckboxFieldProps extends BaseProps {
  type: "checkbox";
  value: boolean;
  onChange: (value: boolean) => void;
}

export type FormFieldProps =
  | NumberFieldProps
  | TextFieldProps
  | SelectFieldProps
  | CheckboxFieldProps;

export default function FormField(props: FormFieldProps) {
  const id = useId();
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const describedBy =
    [props.helperText ? helperId : null, props.error ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  // ── Checkbox has a different layout ──
  if (props.type === "checkbox") {
    return (
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={props.value}
          onChange={(e) => props.onChange(e.target.checked)}
          aria-describedby={describedBy}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-0"
        />
        <div className="flex-1 min-w-0">
          <label
            htmlFor={id}
            className="text-sm font-medium text-gray-800 dark:text-gray-100 cursor-pointer"
          >
            {props.label}
            {props.required && (
              <span className="text-red-600 dark:text-red-400 ml-0.5" aria-hidden="true">
                *
              </span>
            )}
          </label>
          {props.helperText && (
            <p id={helperId} className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {props.helperText}
            </p>
          )}
          {props.error && (
            <p id={errorId} className="text-xs text-red-600 dark:text-red-400 mt-0.5">
              {props.error}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Shared label + helper for number/text/select ──
  const labelEl = (
    <label
      htmlFor={id}
      className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5"
    >
      {props.label}
      {props.required && (
        <span className="text-red-600 dark:text-red-400 ml-0.5" aria-hidden="true">
          *
        </span>
      )}
      {props.tooltip && (
        <span
          className="ml-1 text-gray-400 dark:text-gray-500 cursor-help"
          title={props.tooltip}
          aria-label={`Help: ${props.tooltip}`}
        >
          ⓘ
        </span>
      )}
    </label>
  );

  const helperEl = props.helperText && (
    <p id={helperId} className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
      {props.helperText}
    </p>
  );

  const errorEl = props.error && (
    <p id={errorId} className="text-[11px] text-red-600 dark:text-red-400 mt-1" role="alert">
      {props.error}
    </p>
  );

  // ── Select ──
  if (props.type === "select") {
    return (
      <div>
        {labelEl}
        <select
          id={id}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          aria-invalid={props.error ? "true" : undefined}
          aria-describedby={describedBy}
          className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-colors"
        >
          {props.children}
        </select>
        {helperEl}
        {errorEl}
      </div>
    );
  }

  // ── Number / Text ──
  const isNumber = props.type !== "text";
  const inputType = isNumber ? "number" : "text";
  const numberProps = isNumber
    ? {
        inputMode: "decimal" as const,
        step: (props as NumberFieldProps).step ?? 0.01,
        min: (props as NumberFieldProps).min,
        max: (props as NumberFieldProps).max,
      }
    : {};

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isNumber) {
      const raw = e.target.value;
      const n = raw === "" ? 0 : parseFloat(raw);
      (props.onChange as (v: number) => void)(isNaN(n) ? 0 : n);
    } else {
      (props.onChange as (v: string) => void)(e.target.value);
    }
  };

  return (
    <div>
      {labelEl}
      <div className="relative">
        {props.prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 dark:text-gray-400 pointer-events-none select-none">
            {props.prefix}
          </span>
        )}
        <input
          id={id}
          type={inputType}
          value={
            isNumber
              ? Number.isFinite(props.value as number)
                ? String(props.value)
                : ""
              : String(props.value)
          }
          onChange={handleChange}
          placeholder={(props as NumberFieldProps | TextFieldProps).placeholder}
          aria-invalid={props.error ? "true" : undefined}
          aria-describedby={describedBy}
          {...numberProps}
          className={`w-full border rounded-lg py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-colors ${
            props.error
              ? "border-red-400 dark:border-red-600"
              : "border-gray-200 dark:border-gray-600"
          } ${props.prefix ? "pl-7" : "pl-3"} ${props.suffix ? "pr-10" : "pr-3"}`}
        />
        {props.suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 dark:text-gray-400 pointer-events-none select-none">
            {props.suffix}
          </span>
        )}
      </div>
      {helperEl}
      {errorEl}
    </div>
  );
}
