
declare global {
  namespace NodeJS {
    interface Global {
      fmbConfig?: any;
    }
  }
  
  var fmbConfig: any;
}

// Error type augmentation
interface Error {
  message: string;
  code?: string | number;
  stack?: string;
  name?: string;
}

// Extend Window interface for any global properties
interface Window {
  // Add any window-specific properties if needed
}

export {};
