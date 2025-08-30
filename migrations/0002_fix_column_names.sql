
-- Fix PostgreSQL column names to match camelCase schema
-- This ensures compatibility between PostgreSQL (Replit) and MS SQL (on-prem)

-- Users table
ALTER TABLE users RENAME COLUMN first_name TO "firstName";
ALTER TABLE users RENAME COLUMN last_name TO "lastName";
ALTER TABLE users RENAME COLUMN employee_id TO "employeeId";
ALTER TABLE users RENAME COLUMN profile_image_url TO "profileImageUrl";
ALTER TABLE users RENAME COLUMN is_active TO "isActive";
ALTER TABLE users RENAME COLUMN last_login_at TO "lastLoginAt";
ALTER TABLE users RENAME COLUMN created_at TO "createdAt";
ALTER TABLE users RENAME COLUMN updated_at TO "updatedAt";

-- Add missing columns to users if they don't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(255);

-- Projects table
ALTER TABLE projects RENAME COLUMN project_number TO "projectNumber";
ALTER TABLE projects RENAME COLUMN start_date TO "startDate";
ALTER TABLE projects RENAME COLUMN end_date TO "endDate";
ALTER TABLE projects RENAME COLUMN is_enterprise_wide TO "isEnterpriseWide";
ALTER TABLE projects RENAME COLUMN user_id TO "userId";
ALTER TABLE projects RENAME COLUMN created_at TO "createdAt";
ALTER TABLE projects RENAME COLUMN updated_at TO "updatedAt";
ALTER TABLE projects RENAME COLUMN is_template TO "isTemplate";
ALTER TABLE projects RENAME COLUMN allow_time_tracking TO "allowTimeTracking";
ALTER TABLE projects RENAME COLUMN require_task_selection TO "requireTaskSelection";
ALTER TABLE projects RENAME COLUMN enable_budget_tracking TO "enableBudgetTracking";
ALTER TABLE projects RENAME COLUMN enable_billing TO "enableBilling";

-- Time entries table
ALTER TABLE time_entries RENAME COLUMN user_id TO "userId";
ALTER TABLE time_entries RENAME COLUMN project_id TO "projectId";
ALTER TABLE time_entries RENAME COLUMN task_id TO "taskId";
ALTER TABLE time_entries RENAME COLUMN start_time TO "startTime";
ALTER TABLE time_entries RENAME COLUMN end_time TO "endTime";
ALTER TABLE time_entries RENAME COLUMN created_at TO "createdAt";
ALTER TABLE time_entries RENAME COLUMN updated_at TO "updatedAt";
ALTER TABLE time_entries RENAME COLUMN is_template TO "isTemplate";
ALTER TABLE time_entries RENAME COLUMN is_billable TO "isBillable";
ALTER TABLE time_entries RENAME COLUMN is_approved TO "isApproved";
ALTER TABLE time_entries RENAME COLUMN is_manual_entry TO "isManualEntry";
ALTER TABLE time_entries RENAME COLUMN is_timer_entry TO "isTimerEntry";

-- Tasks table
ALTER TABLE tasks RENAME COLUMN project_id TO "projectId";
ALTER TABLE tasks RENAME COLUMN created_at TO "createdAt";
ALTER TABLE tasks RENAME COLUMN updated_at TO "updatedAt";

-- Employees table
ALTER TABLE employees RENAME COLUMN employee_id TO "employeeId";
ALTER TABLE employees RENAME COLUMN first_name TO "firstName";
ALTER TABLE employees RENAME COLUMN last_name TO "lastName";
ALTER TABLE employees RENAME COLUMN user_id TO "userId";
ALTER TABLE employees RENAME COLUMN created_at TO "createdAt";
ALTER TABLE employees RENAME COLUMN updated_at TO "updatedAt";

-- Organizations table
ALTER TABLE organizations RENAME COLUMN user_id TO "userId";
ALTER TABLE organizations RENAME COLUMN created_at TO "createdAt";
ALTER TABLE organizations RENAME COLUMN updated_at TO "updatedAt";

-- Departments table
ALTER TABLE departments RENAME COLUMN organization_id TO "organizationId";
ALTER TABLE departments RENAME COLUMN manager_id TO "managerId";
ALTER TABLE departments RENAME COLUMN user_id TO "userId";
ALTER TABLE departments RENAME COLUMN created_at TO "createdAt";
ALTER TABLE departments RENAME COLUMN updated_at TO "updatedAt";

-- Project employees table
ALTER TABLE project_employees RENAME COLUMN project_id TO "projectId";
ALTER TABLE project_employees RENAME COLUMN employee_id TO "employeeId";
ALTER TABLE project_employees RENAME COLUMN user_id TO "userId";
ALTER TABLE project_employees RENAME COLUMN created_at TO "createdAt";
ALTER TABLE project_employees RENAME COLUMN updated_at TO "updatedAt";

-- Insert test admin user for authentication
INSERT INTO users (id, email, "firstName", "lastName", role, "isActive", "createdAt", "updatedAt") 
VALUES ('test-admin-user', 'admin@test.com', 'Test', 'Admin', 'admin', true, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET 
  email = EXCLUDED.email,
  "firstName" = EXCLUDED."firstName",
  "lastName" = EXCLUDED."lastName",
  "updatedAt" = NOW();
