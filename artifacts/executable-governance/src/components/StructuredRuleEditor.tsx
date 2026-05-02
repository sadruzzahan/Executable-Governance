import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type StructuredRule = {
  kind: string;
  field: string;
  operator: string;
  value: number | string;
  currency?: string;
  scope?: string;
};

export const DEFAULT_STRUCTURED: StructuredRule = {
  kind: "threshold",
  field: "expense_amount",
  operator: "<=",
  value: 100,
  currency: "USD",
  scope: "",
};

export function StructuredRuleEditor({
  value,
  onChange,
}: {
  value: StructuredRule;
  onChange: (next: StructuredRule) => void;
}) {
  const set = (patch: Partial<StructuredRule>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4" data-testid="structured-editor">
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Structured Condition</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sr-kind">Kind</Label>
          <Select value={value.kind} onValueChange={(v) => set({ kind: v })}>
            <SelectTrigger id="sr-kind" data-testid="select-kind"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="threshold">Threshold</SelectItem>
              <SelectItem value="range">Range</SelectItem>
              <SelectItem value="conditional">Conditional</SelectItem>
              <SelectItem value="allowlist">Allowlist</SelectItem>
              <SelectItem value="denylist">Denylist</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sr-field">Field</Label>
          <Input id="sr-field" value={value.field} onChange={(e) => set({ field: e.target.value })} data-testid="input-field" placeholder="e.g. hotel_per_night" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sr-operator">Operator</Label>
          <Select value={value.operator} onValueChange={(v) => set({ operator: v })}>
            <SelectTrigger id="sr-operator" data-testid="select-operator"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="<=">≤ (less than or equal)</SelectItem>
              <SelectItem value="<">&lt; (less than)</SelectItem>
              <SelectItem value="=">= (equals)</SelectItem>
              <SelectItem value=">">&gt; (greater than)</SelectItem>
              <SelectItem value=">=">≥ (greater than or equal)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sr-value">Value</Label>
          <Input
            id="sr-value"
            type="number"
            value={String(value.value)}
            onChange={(e) => set({ value: e.target.value === "" ? "" : Number(e.target.value) })}
            data-testid="input-value"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sr-currency">Currency</Label>
          <Input id="sr-currency" value={value.currency ?? ""} onChange={(e) => set({ currency: e.target.value })} data-testid="input-currency" placeholder="USD" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sr-scope">Scope (optional)</Label>
          <Input id="sr-scope" value={value.scope ?? ""} onChange={(e) => set({ scope: e.target.value })} data-testid="input-scope" placeholder="e.g. domestic" />
        </div>
      </div>
    </div>
  );
}
