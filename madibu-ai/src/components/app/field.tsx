import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Base { name: string; label: string; error?: string; className?: string; required?: boolean }

export function Field({ name, label, error, className, required, ...props }: Base & Omit<React.ComponentProps<"input">, "name">) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={name}>{label}{required ? " *" : ""}</Label>
      <Input id={name} name={name} required={required} aria-invalid={!!error || undefined} {...props} />
      {error ? <p className="text-xs text-critical">{error}</p> : null}
    </div>
  );
}

export function SelectField({ name, label, error, className, options, required, placeholder, defaultValue }: Base & {
  options: Array<{ value: string; label: string }>; placeholder?: string; defaultValue?: string | null;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={name}>{label}{required ? " *" : ""}</Label>
      <NativeSelect id={name} name={name} required={required} defaultValue={defaultValue ?? ""} aria-invalid={!!error || undefined}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
      {error ? <p className="text-xs text-critical">{error}</p> : null}
    </div>
  );
}

export function TextareaField({ name, label, error, className, ...props }: Base & Omit<React.ComponentProps<"textarea">, "name">) {
  return (
    <div className={cn("grid gap-1.5 sm:col-span-2", className)}>
      <Label htmlFor={name}>{label}</Label>
      <Textarea id={name} name={name} {...props} />
      {error ? <p className="text-xs text-critical">{error}</p> : null}
    </div>
  );
}

export function CheckboxField({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm sm:col-span-2">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4" /> {label}
    </label>
  );
}
