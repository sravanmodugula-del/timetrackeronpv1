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
      const errorText = await res.text();
      if (errorText) {
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.message || errorMessage;
        } catch {
          // If it's not JSON, use the text as is
          errorMessage = errorText;
        }
      }
    } catch {
      // If we can't read the response body, use the status
      errorMessage = `${res.status}: ${res.statusText}`;
    }

    frontendLog('ERROR', 'API', `HTTP ${res.status} error on ${res.url}`, {
      status: res.status,
      statusText: res.statusText,
      errorMessage: errorMessage,
      url: res.url
    });

    throw new Error(errorMessage);
  }
}

export async function apiRequest(
  url: string,
  method: string,
  data?: unknown | undefined,
): Promise<any> {
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
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    const duration = Math.round(performance.now() - startTime);

    frontendLog('DEBUG', 'API', `Response ${requestId}: ${res.status} (${duration}ms)`, {
      requestId,
      status: res.status,
      statusText: res.statusText,
      duration: `${duration}ms`
    });

    if (!res.ok) {
      const errorText = await res.text();

      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText || res.statusText };
      }

      frontendLog('ERROR', 'API', `Request ${requestId} failed`, {
        requestId,
        method,
        url,
        status: res.status,
        error: errorData,
        duration: `${duration}ms`
      });

      const error = new Error(errorData.message || `HTTP ${res.status}: ${res.statusText}`);
      (error as any).status = res.status;
      (error as any).response = { data: errorData };
      (error as any).requestId = requestId;
      throw error;
    }

    // Handle successful response
    const contentType = res.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      const text = await res.text();
      if (!text || text.trim() === '') {
        // Return null for empty responses
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

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);

    // Handle successful response
    const contentType = res.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      const text = await res.text();
      if (!text || text.trim() === '') {
        return null;
      }
      try {
        return JSON.parse(text);
      } catch (error) {
        console.warn('Failed to parse JSON response for query:', queryKey, 'Response:', text.substring(0, 200));
        throw new Error('Invalid JSON response from server');
      }
    }

    const textResponse = await res.text();
    return textResponse || null;
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true, // Refetch on focus for fresh role data
      staleTime: 0, // Always fetch fresh data - critical for role changes
      gcTime: 30 * 1000, // 30 seconds cache time
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});