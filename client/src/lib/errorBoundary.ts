
import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error?: Error; resetError?: () => void }>;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('🔴 [ERROR-BOUNDARY] React error caught:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString()
    });

    // Log to backend if available
    if (typeof window !== 'undefined') {
      fetch('/api/log/frontend-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'ERROR',
          category: 'REACT-ERROR-BOUNDARY',
          message: `React error: ${error.message}`,
          data: {
            error: error.message,
            stack: error.stack,
            componentStack: errorInfo.componentStack,
            url: window.location.href,
            userAgent: navigator.userAgent
          }
        })
      }).catch(() => {
        // Silently fail if logging endpoint is not available
      });
    }
  }

  render() {
    if (this.state.hasError) {
      const resetError = () => {
        this.setState({ hasError: false, error: undefined });
      };

      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback;
        return React.createElement(FallbackComponent, { 
          error: this.state.error, 
          resetError 
        });
      }

      return React.createElement('div', {
        className: 'p-4 border border-red-200 rounded-lg bg-red-50'
      }, [
        React.createElement('h3', {
          key: 'title',
          className: 'text-red-800 font-medium mb-2'
        }, 'Something went wrong'),
        React.createElement('p', {
          key: 'message',
          className: 'text-red-600 text-sm mb-3'
        }, this.state.error?.message || 'An unexpected error occurred'),
        React.createElement('button', {
          key: 'button',
          onClick: resetError,
          className: 'px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700'
        }, 'Try again')
      ]);
    }

    return this.props.children;
  }
}

// Hook for error boundary
export function useErrorBoundary() {
  const [error, setError] = React.useState<Error | null>(null);
  
  const resetError = React.useCallback(() => {
    setError(null);
  }, []);

  const captureError = React.useCallback((error: Error) => {
    setError(error);
  }, []);

  if (error) {
    throw error;
  }

  return { captureError, resetError };
}
