import { useId, type ComponentProps } from "react"

import { Input } from "@/components/ui/input"

/** Labelled input with an optional error message. */
export function FormField({
  label,
  error,
  ...inputProps
}: { label: string; error?: string | undefined } & ComponentProps<typeof Input>) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="type-label-large">
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
      />
      {error ? (
        <p id={errorId} className="type-body-small text-error-text">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Form-level message (error or information). */
export function FormMessage({ tone, children }: { tone: "error" | "info"; children: string }) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={tone === "error" ? "type-body-medium text-error-text" : "type-body-medium text-muted-foreground"}>
      {children}
    </p>
  )
}
