
import { ReactNode } from "react";

interface PageLayoutProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function PageLayout({ title, subtitle, actions, children, className = "" }: PageLayoutProps) {
  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
          {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center space-x-2">{actions}</div>}
      </div>
      <div className={`space-y-4 ${className}`}>
        {children}
      </div>
    </div>
  );
}
