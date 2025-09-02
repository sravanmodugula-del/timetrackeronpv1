
import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Enhanced frontend error logging
function frontendLog(level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG', category: string, message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const emoji = level === 'ERROR' ? '🔴' : level === 'WARN' ? '🟡' : level === 'INFO' ? '🔵' : '🟢';
  const logMessage = `${timestamp} ${emoji} [FRONTEND-${category}] ${message}`;

  // Log to console
  if (data) {
    console.log(logMessage, data);
  } else {
    console.log(logMessage);
  }

  // Send critical errors to backend for centralized logging
  if (level === 'ERROR' && typeof window !== 'undefined') {
    fetch('/api/log/frontend-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        timestamp,
        level,
        category,
        message,
        data,
        url: window.location.href,
        userAgent: navigator.userAgent
      })
    }).catch(() => {
      // Silently fail if logging endpoint is not available
    });
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage = `${res.status}: ${res.statusText}`;
    try {
      const text = await res.text();
      if (text) {
        try {
          const errorData = JSON.parse(text);
          errorMessage = errorData.message || errorMessage;
        } catch {
          errorMessage = text;
        }
      }
    } catch {
      errorMessage = `${res.status}: ${res.statusText}`;
    }
    
    frontendLog('ERROR', 'API', `HTTP ${res.status} error on ${res.url}`, {
      status: res.status,
      statusText: res.statusText,
      errorMessage,
      url: res.url
    });
    
    throw new Error(errorMessage);
  }
}

export async function request(url: string, method = 'GET', data?: any): Promise<any> {
  const requestId = Math.random().toString(36).substr(2, 9);
  
  frontendLog('DEBUG', 'API', `Request ${requestId}: ${method} ${url}`, {
    requestId,
    method,
    url,
    data: method !== 'GET' ? data : undefined
  });

  try {
    const startTime = performance.now();
    const res = await fetch(url, {
      method,
      headers: data ? { 'Content-Type': 'application/json' } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: 'include',
    });
    
    const duration = Math.round(performance.now() - startTime);
    
    frontendLog('DEBUG', 'API', `Response ${requestId}: ${res.status} (${duration}ms)`, {
      requestId,
      status: res.status,
      statusText: res.statusText,
      duration: `${duration}ms`
    });

    if (!res.ok) {
      await throwIfResNotOk(res);
      return;
    }

    // Handle successful response
    const contentType = res.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      const text = await res.text();
      if (!text || text.trim() === '') {
        frontendLog('DEBUG', 'API', `Empty response for ${method} ${url}`, { requestId });
        return null;
      }
      try {
        return JSON.parse(text);
      } catch (error) {
        frontendLog('ERROR', 'API', `JSON parse error for ${method} ${url}`, {
          requestId,
          responseText: text.substring(0, 200),
          error: error instanceof Error ? error.message : 'Unknown parse error'
        });
        throw new Error('Invalid JSON response from server');
      }
    }

    // Handle non-JSON responses
    const textResponse = await res.text();
    if (!textResponse || textResponse.trim() === '') {
      frontendLog('DEBUG', 'API', `Empty text response for ${method} ${url}`, { requestId });
      return null;
    }

    return textResponse;

  } catch (error) {
    frontendLog('ERROR', 'API', `Request ${requestId} exception`, {
      requestId,
      method,
      url,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });
    throw error;
  }
}

// Query client with enhanced error handling
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
      retry: (failureCount, error) => {
        // Don't retry on 401/403 errors
        if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
          return false;
        }
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// Global error handler for uncaught query errors
queryClient.setMutationDefaults(['mutation'], {
  onError: (error) => {
    frontendLog('ERROR', 'MUTATION', 'Uncaught mutation error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

queryClient.setQueryDefaults(['query'], {
  onError: (error) => {
    frontendLog('ERROR', 'QUERY', 'Uncaught query error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});
