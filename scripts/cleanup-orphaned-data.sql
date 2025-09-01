
-- Clean up orphaned data that might be causing 404 errors

-- Remove any tasks without valid project references
DELETE FROM tasks 
WHERE project_id NOT IN (SELECT id FROM projects);

-- Remove any time_entries without valid project or user references
DELETE FROM time_entries 
WHERE project_id NOT IN (SELECT id FROM projects)
   OR user_id NOT IN (SELECT id FROM users);

-- Remove any project_employees without valid references
DELETE FROM project_employees 
WHERE project_id NOT IN (SELECT id FROM projects)
   OR employee_id NOT IN (SELECT id FROM employees);

-- Update any NULL project_id values in tasks (if any)
UPDATE tasks 
SET project_id = (SELECT TOP 1 id FROM projects WHERE user_id = tasks.created_by)
WHERE project_id IS NULL 
  AND created_by IS NOT NULL;

-- Clean up any departments without valid organization references
DELETE FROM departments 
WHERE organization_id NOT IN (SELECT id FROM organizations);

PRINT 'Database cleanup completed';
