// =============================================================================
// TypeScript Interfaces for MS SQL Server Tables
// =============================================================================

import { z } from "zod";

// =============================================================================
// Validation Schemas for API endpoints
// =============================================================================

export const insertProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(255, "Project name must be less than 255 characters"),
  description: z.string().max(2000, "Description must be less than 2000 characters").optional(),
  status: z.enum(['active', 'inactive', 'completed', 'archived']).default('active'),
  organizationId: z.string().optional(),
  departmentId: z.string().optional(),
  managerId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  budget: z.number().min(0, "Budget must be a positive number").optional(),
  projectNumber: z.string().max(50, "Project number must be less than 50 characters").optional(),
  color: z.string().optional(),
  isEnterpriseWide: z.boolean().default(false),
  isTemplate: z.boolean().default(false),
  allowTimeTracking: z.boolean().default(true),
  requireTaskSelection: z.boolean().default(false),
  enableBudgetTracking: z.boolean().default(false),
  enableBilling: z.boolean().default(false),
  user_id: z.string().min(1, "User ID is required"),
});

export const insertTaskSchema = z.object({
  projectId: z.string().min(1, "Project ID is required").optional(),
  project_id: z.string().min(1, "Project ID is required").optional(),
  name: z.string().min(1, "Task name is required"),
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'completed', 'archived']).default('active'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  assignedTo: z.string().optional(),
  assigned_to: z.string().optional(),
  createdBy: z.string().optional(),
  created_by: z.string().optional(),
  dueDate: z.string().optional(),
  due_date: z.string().optional(),
  estimatedHours: z.number().optional(),
  estimated_hours: z.number().optional(),
  actualHours: z.number().default(0).optional(),
  actual_hours: z.number().default(0).optional(),
}).refine((data) => data.projectId || data.project_id, {
  message: "Either projectId or project_id is required",
});

export const insertTimeEntrySchema = z.object({
  userId: z.string().min(1, "User ID is required").optional(),
  user_id: z.string().min(1, "User ID is required").optional(),
  projectId: z.string().optional(),
  project_id: z.string().optional(),
  taskId: z.string().optional(),
  task_id: z.string().optional(),
  description: z.string().optional(),
  hours: z.number().min(0).max(24),
  duration: z.number().min(0),
  date: z.string().min(1, "Date is required"),
  startTime: z.string().optional(),
  start_time: z.string().optional(),
  endTime: z.string().optional(),
  end_time: z.string().optional(),
  status: z.enum(["draft", "submitted", "approved", "rejected"]).default("draft"),
  billable: z.boolean().default(false),
  isBillable: z.boolean().default(false),
  is_billable: z.boolean().default(false),
  isApproved: z.boolean().default(false),
  is_approved: z.boolean().default(false),
  isManualEntry: z.boolean().default(true),
  is_manual_entry: z.boolean().default(true),
  isTimerEntry: z.boolean().default(false),
  is_timer_entry: z.boolean().default(false),
  isTemplate: z.boolean().default(false),
  is_template: z.boolean().default(false)
}).refine((data) => data.userId || data.user_id, {
  message: "Either userId or user_id is required",
});

export const insertEmployeeSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required").max(50, "Employee ID must be less than 50 characters"),
  firstName: z.string().min(1, "First name is required").max(100, "First name must be less than 100 characters"),
  lastName: z.string().min(1, "Last name is required").max(100, "Last name must be less than 100 characters"),
  department: z.string().min(1, "Department is required").max(100, "Department must be less than 100 characters"),
  userId: z.string().optional(),
});

export const insertOrganizationSchema = z.object({
  name: z.string().min(1, "Organization name is required"),
  description: z.string().optional(),
  userId: z.string().min(1, "User ID is required"),
});

export const insertDepartmentSchema = z.object({
  name: z.string().min(1, "Department name is required").max(255, "Department name must be less than 255 characters"),
  organizationId: z.string().min(1, "Organization ID is required"),
  managerId: z.string().optional(),
  description: z.string().optional(),
  userId: z.string().min(1, "User ID is required"),
});

// =============================================================================
// TypeScript Interfaces for MS SQL Server Tables
// =============================================================================

// =============================================================================
// Users Table
// =============================================================================
export interface User {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  profile_image_url?: string;
  role: string;
  organization_id?: string;
  department?: string;
  is_active: boolean;
  last_login_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface InsertUser {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  profile_image_url?: string;
  role?: string;
  organization_id?: string;
  department?: string;
  is_active?: boolean;
}

export interface UpsertUser extends InsertUser {}

export interface UpsertOrganization extends InsertOrganization {}
export interface UpsertEmployee extends InsertEmployee {}
export interface UpsertDepartment extends InsertDepartment {}
export interface UpsertProject extends InsertProject {}
export interface UpsertTask extends InsertTask {}
export interface UpsertTimeEntry extends InsertTimeEntry {}

// =============================================================================
// Organizations Table
// =============================================================================
export interface Organization {
  id: string;
  name: string;
  description?: string;
  user_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface InsertOrganization {
  id: string;
  name: string;
  description?: string;
  user_id: string;
}

export interface OrganizationWithDepartments extends Organization {
  departments: DepartmentWithManager[];
}

// =============================================================================
// Departments Table
// =============================================================================
export interface Department {
  id: string;
  name: string;
  organization_id: string;
  manager_id?: string;
  description?: string;
  user_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface InsertDepartment {
  id: string;
  name: string;
  organization_id: string;
  manager_id?: string;
  description?: string;
  user_id: string;
}

export interface DepartmentWithManager extends Department {
  manager: Employee | null;
  organization: Organization | null;
}

// =============================================================================
// Projects Table
// =============================================================================
export interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  organization_id?: string;
  department_id?: string;
  manager_id?: string;
  user_id: string;
  start_date?: Date;
  end_date?: Date;
  budget?: number;
  project_number?: string;
  color?: string;
  is_enterprise_wide: boolean;
  is_template: boolean;
  allow_time_tracking: boolean;
  require_task_selection: boolean;
  enable_budget_tracking: boolean;
  enable_billing: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface InsertProject {
  id: string;
  name: string;
  description?: string;
  status?: string;
  organization_id?: string;
  department_id?: string;
  manager_id?: string;
  user_id: string;
  start_date?: Date;
  end_date?: Date;
  budget?: number;
  project_number?: string;
  color?: string;
  is_enterprise_wide?: boolean;
  is_template?: boolean;
  allow_time_tracking?: boolean;
  require_task_selection?: boolean;
  enable_budget_tracking?: boolean;
  enable_billing?: boolean;
}

export interface ProjectWithTimeEntries extends Project {
  timeEntries: TimeEntry[];
}

export interface ProjectWithEmployees extends Project {
  assignedEmployees: Employee[];
}

// =============================================================================
// Tasks Table
// =============================================================================
export interface Task {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  status: string;
  priority: string;
  assigned_to?: string;
  created_by?: string;
  due_date?: Date;
  estimated_hours?: number;
  actual_hours?: number;
  created_at: Date;
  updated_at: Date;
}

export interface InsertTask {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  status?: string;
  priority?: string;
  assigned_to?: string;
  created_by?: string;
  due_date?: Date;
  estimated_hours?: number;
  actual_hours?: number;
}

export interface TaskWithProject extends Task {
  project: Project;
}

// =============================================================================
// Time Entries Table
// =============================================================================
export interface TimeEntry {
  id: string;
  user_id: string;
  project_id?: string;
  task_id?: string;
  description?: string;
  hours: number;
  duration: number;
  date: Date;
  start_time?: Date;
  end_time?: Date;
  status: string;
  billable: boolean;
  is_billable: boolean;
  is_approved: boolean;
  is_manual_entry: boolean;
  is_timer_entry: boolean;
  is_template: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface InsertTimeEntry {
  id: string;
  user_id: string;
  project_id?: string;
  task_id?: string;
  description?: string;
  hours: number;
  duration: number;
  date: Date;
  start_time?: Date;
  end_time?: Date;
  status?: string;
  billable?: boolean;
  is_billable?: boolean;
  is_approved?: boolean;
  is_manual_entry?: boolean;
  is_timer_entry?: boolean;
  is_template?: boolean;
}

export interface TimeEntryWithProject extends TimeEntry {
  project?: {
    id: string;
    name: string;
    project_number?: string;
    status?: string;
  };
  task?: {
    id: string;
    name: string;
    description?: string;
  };
}

// =============================================================================
// Employees Table
// =============================================================================
export interface Employee {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  department: string;
  user_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface InsertEmployee {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  department: string;
  user_id?: string;
}

// =============================================================================
// Project Employees Junction Table
// =============================================================================
export interface ProjectEmployee {
  id: string;
  project_id: string;
  employee_id: string;
  user_id: string;
  created_at: Date;
}

export interface InsertProjectEmployee {
  id: string;
  project_id: string;
  employee_id: string;
  user_id: string;
}

// =============================================================================
// Validation Schemas (Basic validation - can be enhanced with Zod if needed)
// =============================================================================

export const ProjectStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  COMPLETED: 'completed',
  ARCHIVED: 'archived'
} as const;

export const TaskStatus = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ARCHIVED: 'archived'
} as const;

export const TaskPriority = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent'
} as const;

export const TimeEntryStatus = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected'
} as const;

export const UserRole = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee'
} as const;