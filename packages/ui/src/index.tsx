import type { HTMLAttributes, ReactNode } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={`ui-card ${className}`} {...props} />;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "info" }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}

export function Kpi({ label, value, change, tone = "blue" }: { label: string; value: string; change?: string; tone?: "blue" | "violet" | "green" | "amber" }) {
  return <Card className="ui-kpi"><span className="ui-kpi__label">{label}</span><strong className={`ui-kpi__value ui-kpi__value--${tone}`}>{value}</strong>{change && <span className="ui-kpi__change">{change}</span>}</Card>;
}
