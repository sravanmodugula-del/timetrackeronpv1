// Global type definitions for missing ES2021/ES2022 types

declare global {
  interface AggregateError extends Error {
    errors: any[];
    constructor(errors: Iterable<any>, message?: string): AggregateError;
  }

  interface ErrorOptions {
    cause?: unknown;
  }

  interface ErrorConstructor {
    new(message?: string, options?: ErrorOptions): Error;
    (message?: string, options?: ErrorOptions): Error;
  }

  var AggregateError: {
    prototype: AggregateError;
    new(errors: Iterable<any>, message?: string): AggregateError;
    (errors: Iterable<any>, message?: string): AggregateError;
  };
}

export interface User {
  id: string;
  email: string;
  password: string;
  role: "admin" | "project_manager" | "manager" | "employee";
  created_at: Date;
  updated_at?: Date;
  is_active: boolean;
  department?: string;
  organization_id?: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  user_id: string;
  status: "active" | "completed" | "archived";
  created_at: Date;
  updated_at?: Date;
  start_date?: Date;
  end_date?: Date;
  project_number?: string;
  is_enterprise_wide: boolean;
  color?: string;
  // CamelCase aliases for frontend
  startDate?: Date;
  endDate?: Date;
  projectNumber?: string;
  isEnterpriseWide?: boolean;
}

export interface TimeEntry {
  id: string;
  user_id: string;
  project_id?: string;
  task_id?: string;
  description?: string;
  hours: number;
  duration: number;
  date: string;
  start_time?: string;
  end_time?: string;
  status?: string;
  billable?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  project_id: string;
  status: "active" | "completed" | "archived";
  created_at: Date;
  updated_at?: Date;
  // CamelCase aliases for frontend
  projectId?: string;
}

export interface Employee {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: "admin" | "project_manager" | "manager" | "employee";
  department?: string;
  organization_id?: string;
  manager_id?: string;
  is_active: boolean;
  created_at: Date;
  updated_at?: Date;
  // CamelCase aliases for frontend
  employeeId?: string;
  firstName?: string;
  lastName?: string;
  organizationId?: string;
  managerId?: string;
}

export interface Department {
  id: string;
  name: string;
  description?: string;
  organization_id: string;
  manager_id?: string;
  created_at: Date;
  updated_at?: Date;
  // CamelCase aliases for frontend
  organizationId?: string;
  managerId?: string;
}

export interface Organization {
  id: string;
  name: string;
  description?: string;
  domain?: string;
  is_active: boolean;
  created_at: Date;
  updated_at?: Date;
}