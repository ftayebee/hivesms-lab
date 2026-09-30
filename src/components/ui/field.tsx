import { cloneElement, isValidElement, useId } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium leading-none text-foreground", className)} {...props} />;
}

interface FieldProps {
  label: React.ReactNode;
  /** Single form control; receives id, aria-invalid, aria-describedby and aria-required. */
  children: React.ReactElement<Record<string, unknown>>;
  hint?: React.ReactNode;
  error?: string | string[] | null;
  required?: boolean;
  optional?: boolean;
  className?: string;
  labelAction?: React.ReactNode;
  id?: string;
}

/**
 * Label above input, hint and error below, all wired up for assistive tech.
 * Required fields show an asterisk and set aria-required.
 */
export function Field({ label, children, hint, error, required, optional, className, labelAction, id: idProp }: FieldProps) {
  const auto = useId();
  const id = idProp ?? (children.props.id as string | undefined) ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorText = Array.isArray(error) ? error[0] : error;
  const errorId = errorText ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        "aria-invalid": errorText ? true : undefined,
        "aria-describedby": describedBy,
        "aria-required": required || undefined,
      })
    : children;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>
          {label}
          {required && (
            <span className="ml-0.5 text-destructive" aria-hidden>
              *
            </span>
          )}
          {optional && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(optional)</span>}
        </Label>
        {labelAction}
      </div>
      {control}
      {hint && !errorText && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {errorText && (
        <p id={errorId} className="text-xs font-medium text-destructive" role="alert">
          {errorText}
        </p>
      )}
    </div>
  );
}
