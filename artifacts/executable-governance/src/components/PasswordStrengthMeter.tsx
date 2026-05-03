import { useMemo } from "react";

interface Props { password: string }

const COMMON = new Set([
  "password","password1","password123","qwerty","letmein","admin","welcome",
  "iloveyou","monkey","dragon","abc123","12345678","123456789","qwerty123",
]);

interface Result { score: 0|1|2|3|4; warnings: string[] }

function score(pw: string): Result {
  if (!pw) return { score: 0, warnings: ["Password is empty"] };
  const w: string[] = [];
  const len = pw.length;
  const lower = /[a-z]/.test(pw);
  const upper = /[A-Z]/.test(pw);
  const digit = /[0-9]/.test(pw);
  const symbol = /[^A-Za-z0-9]/.test(pw);
  const classes = [lower, upper, digit, symbol].filter(Boolean).length;
  if (len < 12) w.push("Use at least 12 characters");
  if (classes < 3) w.push("Mix upper/lower case, digits and symbols");
  if (COMMON.has(pw.toLowerCase())) w.push("Avoid common passwords");
  if (/(.)\1{3,}/.test(pw)) w.push("Avoid long repeating sequences");
  let s: Result["score"] = 0;
  if (len >= 8) s = 1;
  if (len >= 12 && classes >= 2) s = 2;
  if (len >= 14 && classes >= 3) s = 3;
  if (len >= 16 && classes >= 3 && w.length === 0) s = 4;
  if (COMMON.has(pw.toLowerCase())) s = 0;
  return { score: s, warnings: w };
}

const LABELS = ["Too weak", "Weak", "Fair", "Strong", "Excellent"];
const COLORS = [
  "bg-destructive",
  "bg-amber-500",
  "bg-amber-400",
  "bg-emerald-500",
  "bg-emerald-600",
];

export function PasswordStrengthMeter({ password }: Props) {
  const r = useMemo(() => score(password), [password]);
  if (!password) return null;
  return (
    <div className="space-y-1.5" data-testid="strength-meter">
      <div className="grid grid-cols-5 gap-1">
        {[0,1,2,3,4].map((i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full ${i <= r.score ? COLORS[r.score] : "bg-muted"}`}
          />
        ))}
      </div>
      <div className="text-xs text-muted-foreground flex items-center justify-between">
        <span>{LABELS[r.score]}</span>
        <span className="text-[11px]">{password.length} chars</span>
      </div>
      {r.warnings.length > 0 && (
        <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc list-inside">
          {r.warnings.map((w) => (<li key={w}>{w}</li>))}
        </ul>
      )}
    </div>
  );
}
