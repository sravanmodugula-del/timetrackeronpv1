import React from 'react';
import Header from './header';
import { cn } from '@/lib/utils';

interface PageLayoutProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
}

export default function PageLayout({ children, className, title, subtitle }: PageLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      <main className={cn("flex-1 max-w-7xl mx-auto w-full py-6 px-4 sm:px-6 lg:px-8", className)}>
        {title && (
          <div className="mb-8">
            <h1 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate mb-2">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
            )}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

export { PageLayout };