import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// API utility function for making requests
export async function api(url: string, method: string = "GET", data?: any) {
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include", // Important for session cookies
  };

  if (data && method !== "GET") {
    options.body = JSON.stringify(data);
  }

  console.log(`🌐 API Request: ${method} ${url}`, data ? { data } : '');

  const response = await fetch(url, options);

  if (!response.ok) {
    if (response.status === 401) {
      console.error("🔐 Authentication failed for:", url);
      throw new Error("Unauthorized");
    }
    
    let errorData;
    try {
      errorData = await response.json();
      console.error(`❌ API Error (${response.status}):`, errorData);
    } catch (parseError) {
      console.error(`❌ API Error (${response.status}): Failed to parse error response`);
      errorData = {};
    }
    
    // Provide more specific error messages
    const errorMessage = errorData.message || 
      (response.status === 403 ? "Access denied - insufficient permissions" :
       response.status === 404 ? "Resource not found" :
       response.status === 409 ? "Resource already exists" :
       response.status === 422 ? "Invalid data provided" :
       response.status === 500 ? "Server error - please try again" :
       `HTTP ${response.status}`);
    
    const error = new Error(errorMessage);
    (error as any).status = response.status;
    (error as any).details = errorData;
    throw error;
  }

  const result = await response.json();
  console.log(`✅ API Success: ${method} ${url}`, result);
  return result;
}

// API error checking utility
export function isApiError(error: any): boolean {
  return error?.message === "Unauthorized" || error?.status === 401;
}
