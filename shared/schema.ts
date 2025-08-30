// =============================================================================
// TypeScript Interfaces for MS SQL Server Tables
// =============================================================================

import { z } from "zod";

// =============================================================================
// Validation Schemas for API endpoints
// =============================================================================

export const insertProjectSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  description: z.string().optional(),
  status: z.enum(['active', 'inactive', 'completed', 'archived']).default('active'),
  organizationId: z.string().optional(),
  departmentId: z.string().optional(),
  managerId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  budget: z.number().optional(),
  projectNumber: z.string().optional(),
  isEnterpriseWide: z.boolean().default(false),
  isTemplate: z.boolean().default(false),
  allowTimeTracking: z.boolean().default(true),
  requireTaskSelection: z.boolean().default(false),
  enableBudgetTracking: z.boolean().default(false),
  enableBilling: z.boolean().default(false),
});

export const insertTaskSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  title: z.string().min(1, "Task title is required"),
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).default('pending'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  assignedTo: z.string().optional(),
  createdBy: z.string().optional(),
  dueDate: z.string().optional(),
  estimatedHours: z.number().optional(),
  actualHours: z.number().default(0),
});

export const insertTimeEntrySchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  description: z.string().optional(),
  hours: z.number().min(0).max(24),
  duration: z.number().min(0),
  date: z.string().min(1, "Date is required"),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected']).default('draft'),
  billable: z.boolean().default(false),
  isBillable: z.boolean().default(false),
  isApproved: z.boolean().default(false),
  isManualEntry: z.boolean().default(true),
  isTimerEntry: z.boolean().default(false),
  isTemplate: z.boolean().default(false),
});

export const insertEmployeeSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  department: z.string().min(1, "Department is required"),
  userId: z.string().optional(),
});

export const insertOrganizationSchema = z.object({
  name: z.string().min(1, "Organization name is required"),
  description: z.string().optional(),
  userId: z.string().min(1, "User ID is required"),
});

export const insertDepartmentSchema = z.object({
  name: z.string().min(1, "Department name is required"),
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
  title: string;
  name?: string;
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
  title: string;
  name?: string;
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
  project: Project;
  task: Task | null;
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
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
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