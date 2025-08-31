import type { Express } from "express";
import { createServer, type Server } from "http";
import type { RequestHandler } from "express";
// Storage abstraction - use appropriate storage based on environment
import { getFmbStorage } from '../fmb-onprem/config/fmb-database.js';
import { insertProjectSchema, insertTaskSchema, insertTimeEntrySchema, insertEmployeeSchema } from "../shared/schema.js";
import { z } from "zod";

// Import SAML debug routes
import fmbSamlRoutes from './routes/fmb-saml.js';
import healthRoutes from './routes/health.js';
import sessionRoutes from './routes/session-management.js';
import samlDebugRoutes from './routes/saml-debug.js';

// Role-based permissions helper
function getRolePermissions(role: string) {
  const permissions = {
    admin: [
      'manage_users', 'manage_system', 'view_all_projects', 'manage_all_departments',
      'generate_all_reports', 'system_configuration'
    ],
    manager: [
      'manage_department', 'view_department_projects', 'manage_employees',
      'generate_department_reports', 'view_department_analytics'
    ],
    project_manager: [
      'create_projects', 'manage_projects', 'view_project_analytics',
      'generate_project_reports', 'manage_tasks', 'assign_team_members'
    ],
    employee: [
      'log_time', 'view_assigned_projects', 'view_own_reports',
      'manage_profile', 'complete_tasks'
    ],
    viewer: [
      'view_assigned_projects', 'view_own_time_entries', 'view_basic_reports'
    ]
  };

  return permissions[role as keyof typeof permissions] || permissions.employee;
}

// Use FMB storage only
function getStorage() {
  return getFmbStorage();
}

// Helper function to extract user ID from FMB SAML user object
function extractUserId(user: any): string {
  // FMB SAML user object structure
  return user.userId || user.email || user.id;
}

// Helper function to get user by ID
async function getUserById(userId: string) {
  const activeStorage = getStorage();
  try {
    // Attempt to get user using the provided ID, which could be from SAML (id/email)
    const user = await activeStorage.getUser(userId);
    // If not found with the direct ID, and it looks like an email, try searching by email
    if (!user && userId.includes('@')) {
      // Check if the storage has getUserByEmail method (FMB storage)
      if ('getUserByEmail' in activeStorage && typeof activeStorage.getUserByEmail === 'function') {
        const userByEmail = await (activeStorage as any).getUserByEmail(userId);
        return userByEmail;
      }
    }
    return user;
  } catch (error) {
    console.error(`Error getting user ${userId}:`, error);
    return undefined;
  }
}

// Placeholder for database health check (to be implemented)
async function checkDatabaseHealth(): Promise<boolean> {
  // In a real scenario, this would involve a database connection check.
  // For now, assume it's healthy if we can proceed.
  try {
    const storage = getStorage();
    // Attempt a simple operation that requires a database connection
    await storage.pingDatabase(); // Assuming a pingDatabase method exists
    return true;
  } catch (error) {
    console.error("Database health check failed:", error);
    return false;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // FMB SAML Authentication setup
  console.log('🚀 Setting up FMB SAML Authentication for On-Premises environment...');
  const { setupFmbSamlAuth, isAuthenticated } = await import('../fmb-onprem/auth/fmb-saml-auth.js');
  await setupFmbSamlAuth(app);

  // Register enterprise session management routes
  try {
    const { registerSessionManagementRoutes } = await import('./routes/session-management.js');
    registerSessionManagementRoutes(app);
    console.log('🛡️ [SESSION-MGMT] Enterprise session management routes registered');
  } catch (error) {
    console.error('🔴 [SESSION-MGMT] Failed to register session management routes:', error);
  }

  // Auth routes
  // Get current user
  app.get("/api/auth/user", isAuthenticated, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      // Extract user ID using helper function
      const userId = extractUserId(user);
      const email = user.email;

      if (!userId) {
        console.error("No user identifier found in user object:", user);
        return res.status(400).json({ message: "Invalid user data" });
      }

      // Get user from database
      const dbUser = await getUserById(userId);

      if (!dbUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        id: dbUser.id,
        email: dbUser.email,
        firstName: dbUser.first_name,
        lastName: dbUser.last_name,
        role: dbUser.role,
        profileImageUrl: dbUser.profile_image_url
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Project routes
  app.get('/api/projects', isAuthenticated, async (req, res) => {
    try {
      // Extract user ID using consistent helper function
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const projects = await activeStorage.getProjectsByUserId(userId);
      res.json(projects);
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  app.get('/api/projects/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const activeStorage = getStorage();
      const project = await activeStorage.getProject(id, userId);

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      res.json(project);
    } catch (error) {
      console.error("Error fetching project:", error);
      res.status(500).json({ message: "Failed to fetch project" });
    }
  });

  app.post('/api/projects', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      const userRole = user?.role || 'employee';

      // Only project managers and admins can create projects
      if (!['admin', 'project_manager'].includes(userRole)) {
        return res.status(403).json({ message: "Insufficient permissions to create projects" });
      }

      // Ensure user_id is properly set
      const projectData = insertProjectSchema.parse({ ...req.body, user_id: userId });
      console.log('📁 Creating project with data:', { ...projectData, user_id: userId });

      const project = await activeStorage.createProject(projectData);
      res.status(201).json(project);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid project data", errors: error.errors });
      }
      console.error("Error creating project:", error);
      res.status(500).json({ message: "Failed to create project" });
    }
  });

  app.patch('/api/projects/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const activeStorage = getStorage();
      const projectData = insertProjectSchema.partial().parse(req.body);
      const project = await activeStorage.updateProject(id, projectData, userId);

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      res.json(project);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid project data", errors: error.errors });
      }
      if (error instanceof Error && error.message.includes('Insufficient permissions')) {
        return res.status(403).json({ message: error.message });
      }
      console.error("Error updating project:", error);
      res.status(500).json({ message: "Failed to update project" });
    }
  });

  app.put('/api/projects/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const activeStorage = getStorage();
      const projectData = insertProjectSchema.partial().parse(req.body);
      const project = await activeStorage.updateProject(id, projectData, userId);

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      res.json(project);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid project data", errors: error.errors });
      }
      console.error("Error updating project:", error);
      res.status(500).json({ message: "Failed to update project" });
    }
  });

  app.delete('/api/projects/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const activeStorage = getStorage();
      const deleted = await activeStorage.deleteProject(id, userId);

      if (!deleted) {
        return res.status(404).json({ message: "Project not found" });
      }

      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message.includes('Insufficient permissions')) {
        return res.status(403).json({ message: error.message });
      }
      console.error("Error deleting project:", error);
      res.status(500).json({ message: "Failed to delete project" });
    }
  });

  // Project access control routes
  app.get('/api/projects/:id/employees', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      const userRole = user?.role || 'employee';

      // Only admins and project managers can view project employee assignments
      if (!['admin', 'project_manager'].includes(userRole)) {
        return res.status(403).json({ message: "Insufficient permissions to view project employee assignments" });
      }

      const { id } = req.params;
      const employees = await activeStorage.getProjectEmployees(id, userId);
      res.json(employees);
    } catch (error) {
      console.error("Error fetching project employees:", error);
      res.status(500).json({ message: "Failed to fetch project employees" });
    }
  });

  app.post('/api/projects/:id/employees', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      const userRole = user?.role || 'employee';

      // Only admins and project managers can assign employees to projects
      if (!['admin', 'project_manager'].includes(userRole)) {
        return res.status(403).json({ message: "Insufficient permissions to assign employees to projects" });
      }

      const { id } = req.params;
      const { employeeIds } = req.body;

      if (!Array.isArray(employeeIds)) {
        return res.status(400).json({ message: "employeeIds must be an array" });
      }

      await activeStorage.assignEmployeesToProject(id, employeeIds, userId);
      res.status(200).json({ message: "Employees assigned successfully" });
    } catch (error) {
      console.error("Error assigning employees to project:", error);
      res.status(500).json({ message: "Failed to assign employees to project" });
    }
  });

  app.delete('/api/projects/:id/employees/:employeeId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      const userRole = user?.role || 'employee';

      // Only admins and project managers can remove employees from projects
      if (!['admin', 'project_manager'].includes(userRole)) {
        return res.status(403).json({ message: "Insufficient permissions to remove employees from projects" });
      }

      const { id, employeeId } = req.params;
      const removed = await activeStorage.removeEmployeeFromProject(id, employeeId, userId);

      if (!removed) {
        return res.status(404).json({ message: "Employee assignment not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error removing employee from project:", error);
      res.status(500).json({ message: "Failed to remove employee from project" });
    }
  });

  // Task routes
  app.get('/api/projects/:projectId/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { projectId } = req.params;
      const activeStorage = getStorage();
      const tasks = await activeStorage.getTasks(projectId, userId);
      res.json(tasks);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  // Get all tasks across projects for cloning (must be before /api/tasks/:id)
  app.get('/api/tasks/all', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const tasks = await activeStorage.getAllUserTasks(userId);
      res.json(tasks);
    } catch (error) {
      console.error("Error fetching all tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get('/api/tasks/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const activeStorage = getStorage();
      const task = await activeStorage.getTask(id, userId);

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      res.json(task);
    } catch (error) {
      console.error("Error fetching task:", error);
      res.status(500).json({ message: "Failed to fetch task" });
    }
  });

  app.post('/api/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      const userRole = user?.role || 'employee';

      // Only project managers and admins can create tasks
      if (!['admin', 'project_manager'].includes(userRole)) {
        return res.status(403).json({ message: "Insufficient permissions to create tasks" });
      }

      const taskData = insertTaskSchema.parse(req.body);

      // Verify project exists (project access is now enterprise-wide)
      const project = await activeStorage.getProject(taskData.projectId, userId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const task = await activeStorage.createTask(taskData);
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      console.error("Error creating task:", error);
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  app.put('/api/tasks/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      const userRole = user?.role || 'employee';

      // Only project managers and admins can edit tasks
      if (!['admin', 'project_manager'].includes(userRole)) {
        return res.status(403).json({ message: "Insufficient permissions to edit tasks" });
      }

      const { id } = req.params;
      const taskData = insertTaskSchema.partial().parse(req.body);
      const task = await activeStorage.updateTask(id, taskData, userId);

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      res.json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      console.error("Error updating task:", error);
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  app.delete('/api/tasks/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const activeStorage = getStorage();
      const deleted = await activeStorage.deleteTask(id, userId);

      if (!deleted) {
        return res.status(404).json({ message: "Task not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  // Clone task to another project
  app.post('/api/tasks/:id/clone', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const { targetProjectId } = req.body;
      const activeStorage = getStorage();

      if (!targetProjectId) {
        return res.status(400).json({ message: "Target project ID is required" });
      }

      // Get the original task
      const originalTask = await activeStorage.getTask(id, userId);
      if (!originalTask) {
        return res.status(404).json({ message: "Task not found" });
      }

      // Verify user owns the target project
      const targetProject = await activeStorage.getProject(targetProjectId, userId);
      if (!targetProject) {
        return res.status(403).json({ message: "Access denied to target project" });
      }

      // Clone the task
      const clonedTask = await activeStorage.createTask({
        projectId: targetProjectId,
        name: originalTask.name,
        description: originalTask.description,
        status: "active", // Reset status to active for cloned tasks
      });

      res.status(201).json(clonedTask);
    } catch (error) {
      console.error("Error cloning task:", error);
      res.status(500).json({ message: "Failed to clone task" });
    }
  });

  // Time entry routes
  app.get('/api/time-entries', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { projectId, startDate, endDate, limit, offset } = req.query;
      const activeStorage = getStorage();

      const filters = {
        projectId: (projectId === "all" || !projectId) ? undefined : projectId as string,
        startDate: startDate as string,
        endDate: endDate as string,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      };

      const timeEntries = await activeStorage.getTimeEntries(userId, filters);
      res.json(timeEntries);
    } catch (error) {
      console.error("Error fetching time entries:", error);
      res.status(500).json({ message: "Failed to fetch time entries" });
    }
  });

  app.get('/api/time-entries/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const activeStorage = getStorage();
      const timeEntry = await activeStorage.getTimeEntry(id, userId);

      if (!timeEntry) {
        return res.status(404).json({ message: "Time entry not found" });
      }

      res.json(timeEntry);
    } catch (error) {
      console.error("Error fetching time entry:", error);
      res.status(500).json({ message: "Failed to fetch time entry" });
    }
  });

  app.post('/api/time-entries', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();

      console.log("📝 Time Entry Request Body:", JSON.stringify(req.body, null, 2));

      // Handle manual duration mode by providing default start/end times
      let processedData = { ...req.body, userId };
      if (processedData.duration && !processedData.startTime && !processedData.endTime) {
        // For manual duration, set dummy start/end times that match the duration
        processedData.startTime = "09:00";
        const durationHours = parseFloat(processedData.duration);
        const endHour = 9 + Math.floor(durationHours);
        const endMinute = Math.round((durationHours % 1) * 60);
        processedData.endTime = `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`;
      }

      const entryData = insertTimeEntrySchema.parse(processedData);

      console.log("✅ Parsed Entry Data:", JSON.stringify(entryData, null, 2));

      const timeEntry = await activeStorage.createTimeEntry(entryData);
      res.status(201).json(timeEntry);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("❌ Validation Error:", error.errors);
        return res.status(400).json({ message: "Invalid time entry data", errors: error.errors });
      }
      console.error("Error creating time entry:", error);
      res.status(500).json({ message: "Failed to create time entry" });
    }
  });

  app.put('/api/time-entries/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const activeStorage = getStorage();
      // Handle partial updates for time entries
      const partialSchema = insertTimeEntrySchema.deepPartial();
      const entryData = partialSchema.parse(req.body);
      const timeEntry = await activeStorage.updateTimeEntry(id, entryData, userId);

      if (!timeEntry) {
        return res.status(404).json({ message: "Time entry not found" });
      }

      res.json(timeEntry);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid time entry data", errors: error.errors });
      }
      console.error("Error updating time entry:", error);
      res.status(500).json({ message: "Failed to update time entry" });
    }
  });

  app.delete('/api/time-entries/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const activeStorage = getStorage();
      const deleted = await activeStorage.deleteTimeEntry(id, userId);

      if (!deleted) {
        return res.status(404).json({ message: "Time entry not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting time entry:", error);
      res.status(500).json({ message: "Failed to delete time entry" });
    }
  });

  // Dashboard routes - require authentication
  app.get('/api/dashboard/stats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { startDate, endDate } = req.query;
      const activeStorage = getStorage();
      const stats = await activeStorage.getDashboardStats(
        userId,
        startDate as string,
        endDate as string
      );
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  app.get('/api/dashboard/project-breakdown', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { startDate, endDate } = req.query;
      const activeStorage = getStorage();
      const breakdown = await activeStorage.getProjectTimeBreakdown(
        userId,
        startDate as string,
        endDate as string
      );
      res.json(breakdown);
    } catch (error) {
      console.error("Error fetching project breakdown:", error);
      res.status(500).json({ message: "Failed to fetch project breakdown" });
    }
  });

  app.get('/api/dashboard/recent-activity', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { limit, startDate, endDate } = req.query;
      const activeStorage = getStorage();
      const activity = await activeStorage.getRecentActivity(
        userId,
        limit ? parseInt(limit as string) : undefined,
        startDate as string,
        endDate as string
      );
      res.json(activity);
    } catch (error) {
      console.error("Error fetching recent activity:", error);
      res.status(500).json({ message: "Failed to fetch recent activity" });
    }
  });

  app.get('/api/dashboard/department-hours', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { startDate, endDate } = req.query;
      const activeStorage = getStorage();
      console.log("🏢 Fetching department hours for user:", userId, "dates:", startDate, endDate);
      const departmentHours = await activeStorage.getDepartmentHoursSummary(userId, startDate as string, endDate as string);
      console.log("📊 Department hours result:", JSON.stringify(departmentHours, null, 2));
      res.json(departmentHours);
    } catch (error) {
      console.error("❌ Error fetching department hours:", error);
      res.status(500).json({ message: "Failed to fetch department hours" });
    }
  });

  // User role management routes
  app.get('/api/users/current-role', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      res.json({
        role: user?.role || 'employee',
        permissions: getRolePermissions(user?.role || 'employee')
      });
    } catch (error) {
      console.error("Error fetching user role:", error);
      res.status(500).json({ message: "Failed to fetch user role" });
    }
  });

  app.post('/api/users/change-role', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { role } = req.body;
      const activeStorage = getStorage();

      const validRoles = ['admin', 'manager', 'project_manager', 'employee', 'viewer'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }

      await activeStorage.updateUserRole(userId, role);
      res.json({ message: "Role updated successfully", role });
    } catch (error) {
      console.error("Error changing user role:", error);
      res.status(500).json({ message: "Failed to change user role" });
    }
  });

  // Employee routes
  app.get('/api/employees', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const employees = await activeStorage.getEmployees(userId);
      res.json(employees);
    } catch (error) {
      console.error("Error fetching employees:", error);
      res.status(500).json({ message: "Failed to fetch employees" });
    }
  });

  app.get('/api/employees/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const activeStorage = getStorage();
      const employee = await activeStorage.getEmployee(id, userId);

      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      res.json(employee);
    } catch (error) {
      console.error("Error fetching employee:", error);
      res.status(500).json({ message: "Failed to fetch employee" });
    }
  });

  app.post('/api/employees', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      const userRole = user?.role || 'employee';

      // Only admins and department managers can create employees
      if (!['admin', 'manager'].includes(userRole)) {
        return res.status(403).json({ message: "Insufficient permissions to create employees" });
      }

      const employeeData = insertEmployeeSchema.parse({ ...req.body, userId });
      const employee = await activeStorage.createEmployee(employeeData);
      res.status(201).json(employee);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid employee data", errors: error.errors });
      }
      console.error("Error creating employee:", error);
      res.status(500).json({ message: "Failed to create employee" });
    }
  });

  app.put('/api/employees/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      const userRole = user?.role || 'employee';

      // Only admins and department managers can update employees
      if (!['admin', 'manager'].includes(userRole)) {
        return res.status(403).json({ message: "Insufficient permissions to update employees" });
      }

      const { id } = req.params;
      const employeeData = insertEmployeeSchema.partial().parse(req.body);
      const employee = await activeStorage.updateEmployee(id, employeeData, userId);

      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      res.json(employee);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid employee data", errors: error.errors });
      }
      console.error("Error updating employee:", error);
      res.status(500).json({ message: "Failed to update employee" });
    }
  });

  app.delete('/api/employees/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      const userRole = user?.role || 'employee';

      // Only admins and department managers can delete employees
      if (!['admin', 'manager'].includes(userRole)) {
        return res.status(403).json({ message: "Insufficient permissions to delete employees" });
      }

      const { id } = req.params;
      const deleted = await activeStorage.deleteEmployee(id, userId);

      if (!deleted) {
        return res.status(404).json({ message: "Employee not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting employee:", error);
      res.status(500).json({ message: "Failed to delete employee" });
    }
  });

  // Department routes
  app.get("/api/departments", isAuthenticated, async (req: any, res) => {
    try {
      const activeStorage = getStorage();
      const departments = await activeStorage.getDepartments();
      console.log(`📋 Departments API: Found ${departments.length} departments`);
      res.json(departments);
    } catch (error) {
      console.error("❌ Error fetching departments:", error);
      res.status(500).json({ message: "Failed to fetch departments" });
    }
  });

  app.get("/api/departments/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const activeStorage = getStorage();
      const department = await activeStorage.getDepartment(id);

      if (!department) {
        return res.status(404).json({ message: "Department not found" });
      }

      res.json(department);
    } catch (error) {
      console.error("Error fetching department:", error);
      res.status(500).json({ message: "Failed to fetch department" });
    }
  });

  app.post("/api/departments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      const userRole = user?.role || 'employee';

      // Only system administrators can create departments
      if (userRole !== 'admin') {
        return res.status(403).json({ message: "Insufficient permissions to create departments" });
      }

      const departmentData = { ...req.body, userId };
      const department = await activeStorage.createDepartment(departmentData);
      res.status(201).json(department);
    } catch (error) {
      console.error("Error creating department:", error);
      res.status(500).json({ message: "Failed to create department" });
    }
  });

  app.put("/api/departments/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      const userRole = user?.role || 'employee';

      // Only system administrators can update departments
      if (userRole !== 'admin') {
        return res.status(403).json({ message: "Insufficient permissions to update departments" });
      }

      const department = await activeStorage.updateDepartment(id, req.body, userId);

      if (!department) {
        return res.status(404).json({ message: "Department not found" });
      }

      res.json(department);
    } catch (error) {
      console.error("Error updating department:", error);
      res.status(500).json({ message: "Failed to update department" });
    }
  });

  app.delete("/api/departments/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      const userRole = user?.role || 'employee';

      // Only system administrators can delete departments
      if (userRole !== 'admin') {
        return res.status(403).json({ message: "Insufficient permissions to delete departments" });
      }

      const success = await activeStorage.deleteDepartment(id, userId);

      if (!success) {
        return res.status(404).json({ message: "Department not found" });
      }

      res.json({ message: "Department deleted successfully" });
    } catch (error) {
      console.error("Error deleting department:", error);
      res.status(500).json({ message: "Failed to delete department" });
    }
  });

  app.post("/api/departments/:id/manager", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { managerId } = req.body;
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();

      await activeStorage.assignManagerToDepartment(id, managerId, userId);
      res.json({ message: "Manager assigned successfully" });
    } catch (error) {
      console.error("Error assigning manager:", error);
      res.status(500).json({ message: "Failed to assign manager" });
    }
  });

  // User Management routes (Admin only)
  app.get("/api/admin/users", isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);

      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Only System Administrators can view all users" });
      }

      const users = await activeStorage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get("/api/admin/users/without-employee", isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);

      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Only System Administrators can view unlinked users" });
      }

      const users = await activeStorage.getUsersWithoutEmployeeProfile();
      res.json(users);
    } catch (error) {
      console.error("Error fetching unlinked users:", error);
      res.status(500).json({ message: "Failed to fetch unlinked users" });
    }
  });

  app.post("/api/admin/employees/:employeeId/link-user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);

      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Only System Administrators can link users to employees" });
      }

      const { employeeId } = req.params;
      const { userId: targetUserId } = req.body;

      const linkedEmployee = await activeStorage.linkUserToEmployee(targetUserId, employeeId);

      if (!linkedEmployee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      res.json({ message: "User successfully linked to employee", employee: linkedEmployee });
    } catch (error) {
      console.error("Error linking user to employee:", error);
      res.status(500).json({ message: "Failed to link user to employee" });
    }
  });

  // Admin: Update user role
  app.post("/api/admin/users/:userId/role", isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = extractUserId(req.user);
      const activeStorage = getStorage();
      const currentUser = await activeStorage.getUser(currentUserId);

      if (currentUser?.role !== 'admin') {
        return res.status(403).json({ message: "Only System Administrators can change user roles" });
      }

      const { userId: targetUserId } = req.params;
      const { role } = req.body;

      if (!role) {
        return res.status(400).json({ message: "Role is required" });
      }

      const validRoles = ['admin', 'manager', 'project_manager', 'employee', 'viewer'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ message: `Invalid role specified. Valid roles: ${validRoles.join(', ')}` });
      }

      // Prevent users from removing their own admin role
      if (currentUserId === targetUserId && role !== 'admin') {
        return res.status(400).json({ message: "Cannot remove your own admin privileges" });
      }

      const updatedUser = await activeStorage.updateUserRole(targetUserId, role);

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ message: "User role updated successfully", user: updatedUser });
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({
        message: "Failed to update user role",
        error: process.env.NODE_ENV === 'production' ? 'Internal server error' : (error as Error).message
      });
    }
  });

  // Organization routes
  app.get("/api/organizations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const organizations = await activeStorage.getOrganizationsByUserId(userId);
      res.json(organizations);
    } catch (error) {
      console.error("Error fetching organizations:", error);
      res.status(500).json({ message: "Failed to fetch organizations" });
    }
  });

  app.get("/api/organizations/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const organization = await activeStorage.getOrganization(id, userId);

      if (!organization) {
        return res.status(404).json({ message: "Organization not found" });
      }

      res.json(organization);
    } catch (error) {
      console.error("Error fetching organization:", error);
      res.status(500).json({ message: "Failed to fetch organization" });
    }
  });

  // Enhanced organization creation with comprehensive validation
  app.post("/api/organizations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      console.log(`🔍 [ORG-CREATE-${requestId}] Starting organization creation`, {
        userId: userId ? '[PRESENT]' : '[MISSING]',
        bodyKeys: Object.keys(req.body || {}),
        userAgent: req.get('User-Agent')?.substring(0, 100)
      });

      // DEBUG: Log exact POST parameters being received
      console.log(`🔍 [ORG-CREATE-${requestId}] POST Parameters Debug:`, {
        rawBody: req.body,
        bodyType: typeof req.body,
        bodyStringified: JSON.stringify(req.body, null, 2),
        headers: {
          contentType: req.get('Content-Type'),
          contentLength: req.get('Content-Length'),
          authorization: req.get('Authorization') ? '[PRESENT]' : '[MISSING]'
        },
        user: {
          id: req.user?.id || '[MISSING]',
          email: req.user?.email || '[MISSING]',
          extractedUserId: userId,
          userKeys: req.user ? Object.keys(req.user) : 'null'
        }
      });

      // Comprehensive input validation
      if (!userId || typeof userId !== 'string') {
        console.error(`❌ [ORG-CREATE-${requestId}] Invalid user session`, {
          userObject: req.user ? Object.keys(req.user) : 'null',
          extractedUserId: userId
        });
        return res.status(401).json({
          message: "Invalid user session. Please log in again.",
          code: "INVALID_SESSION"
        });
      }

      // Validate request body
      if (!req.body || typeof req.body !== 'object') {
        console.error(`❌ [ORG-CREATE-${requestId}] Invalid request body`);
        return res.status(400).json({
          message: "Invalid request data",
          code: "INVALID_REQUEST_BODY"
        });
      }

      const { name, description } = req.body;

      // Validate organization name
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        console.error(`❌ [ORG-CREATE-${requestId}] Invalid organization name`, { name });
        return res.status(400).json({
          message: "Organization name is required and must be a non-empty string",
          code: "INVALID_NAME"
        });
      }

      if (name.trim().length > 255) {
        return res.status(400).json({
          message: "Organization name must be less than 255 characters",
          code: "NAME_TOO_LONG"
        });
      }

      // Validate description if provided
      if (description && (typeof description !== 'string' || description.length > 1000)) {
        return res.status(400).json({
          message: "Description must be a string with less than 1000 characters",
          code: "INVALID_DESCRIPTION"
        });
      }

      const activeStorage = getStorage();

      // Get user and validate permissions
      const user = await activeStorage.getUser(userId);
      if (!user) {
        console.error(`❌ [ORG-CREATE-${requestId}] User not found in database`, { userId });
        return res.status(401).json({
          message: "User not found. Please log in again.",
          code: "USER_NOT_FOUND"
        });
      }

      const userRole = user.role || 'employee';
      console.log(`🔍 [ORG-CREATE-${requestId}] User validation successful`, {
        userRole,
        userName: `${user.first_name} ${user.last_name}`
      });

      // Check admin permissions
      if (userRole !== 'admin') {
        console.warn(`🚫 [ORG-CREATE-${requestId}] Insufficient permissions`, { userRole });
        return res.status(403).json({
          message: "Only System Administrators can create organizations",
          code: "INSUFFICIENT_PERMISSIONS",
          requiredRole: "admin",
          currentRole: userRole
        });
      }

      // Prepare sanitized organization data
      const organizationData = {
        name: name.trim(),
        description: description?.trim() || undefined,
        user_id: userId
      };

      console.log(`🏢 [ORG-CREATE-${requestId}] Creating organization`, {
        name: organizationData.name,
        hasDescription: !!organizationData.description,
        descriptionLength: organizationData.description?.length || 0
      });

      // DEBUG: Log exact data being passed to createOrganization
      console.log(`🔍 [ORG-CREATE-${requestId}] Database Call Parameters:`, {
        organizationData: JSON.stringify(organizationData, null, 2),
        name: organizationData.name,
        description: organizationData.description,
        user_id: organizationData.user_id,
        dataTypes: {
          name: typeof organizationData.name,
          description: typeof organizationData.description,
          user_id: typeof organizationData.user_id
        },
        lengths: {
          name: organizationData.name?.length,
          description: organizationData.description?.length,
          user_id: organizationData.user_id?.length
        }
      });

      // Create organization with enhanced error handling
      const organization = await activeStorage.createOrganization(organizationData);

      console.log(`✅ [ORG-CREATE-${requestId}] Organization created successfully`, {
        organizationId: organization.id,
        name: organization.name
      });

      res.status(201).json({
        ...organization,
        message: "Organization created successfully"
      });

    } catch (error: any) {
      const requestId = `req-${Date.now()}`;
      console.error(`❌ [ORG-CREATE-${requestId}] Organization creation failed`, {
        message: error?.message,
        code: error?.code,
        sqlState: error?.state,
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined
      });

      // Handle specific error types
      if (error?.message?.includes("already exists")) {
        return res.status(409).json({
          message: error.message,
          code: "DUPLICATE_NAME"
        });
      }

      if (error?.message?.includes("user_id")) {
        return res.status(400).json({
          message: "Invalid user data. Please log in again.",
          code: "INVALID_USER_DATA"
        });
      }

      // Generic server error
      res.status(500).json({
        message: "Failed to create organization. Please try again.",
        code: "INTERNAL_ERROR",
        requestId
      });
    }
  });

  app.put("/api/organizations/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      const userRole = user?.role || 'employee';

      // Only system administrators can update organizations
      if (userRole !== 'admin') {
        return res.status(403).json({ message: "Insufficient permissions to update organizations" });
      }

      const organization = await activeStorage.updateOrganization(id, req.body, userId);

      if (!organization) {
        return res.status(404).json({ message: "Organization not found" });
      }

      res.json(organization);
    } catch (error) {
      console.error("Error updating organization:", error);
      res.status(500).json({ message: "Failed to update organization" });
    }
  });

  app.delete("/api/organizations/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();
      const user = await activeStorage.getUser(userId);
      const userRole = user?.role || 'employee';

      // Only system administrators can delete organizations
      if (userRole !== 'admin') {
        return res.status(403).json({ message: "Insufficient permissions to delete organizations" });
      }

      const success = await activeStorage.deleteOrganization(id, userId);

      if (!success) {
        return res.status(404).json({ message: "Organization not found" });
      }

      res.json({ message: "Organization deleted successfully" });
    } catch (error) {
      console.error("Error deleting organization:", error);
      res.status(500).json({ message: "Failed to delete organization" });
    }
  });

  app.get("/api/organizations/:id/departments", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const activeStorage = getStorage();
      const departments = await activeStorage.getDepartmentsByOrganization(id);
      res.json(departments);
    } catch (error) {
      console.error("Error fetching organization departments:", error);
      res.status(500).json({ message: "Failed to fetch organization departments" });
    }
  });

  // Reports routes
  app.get('/api/reports/project-time-entries/:projectId', isAuthenticated, async (req: any, res) => {
    try {
      const { projectId } = req.params;
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();

      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const currentUser = await activeStorage.getUser(userId);

      // Check if user has permission to view reports
      const allowedRoles = ['project_manager', 'admin', 'manager'];
      if (!currentUser || !allowedRoles.includes(currentUser.role || 'employee')) {
        return res.status(403).json({ message: "Insufficient permissions to view reports" });
      }

      // Get time entries for the project with employee information
      const timeEntries = await activeStorage.getTimeEntriesForProject(projectId);

      res.json(timeEntries);
    } catch (error) {
      console.error("Error fetching project time entries:", error);
      res.status(500).json({ message: "Failed to fetch project time entries" });
    }
  });

  // Frontend error logging endpoint
  app.post('/api/log/frontend-error', async (req, res) => {
    try {
      const { timestamp, level, category, message, data, url, userAgent } = req.body;

      // Enhanced frontend error logging to server console
      const logMessage = `${timestamp} 🔴 [FRONTEND-${category}] ${message}`;
      console.log(logMessage, {
        data,
        url,
        userAgent,
        ip: req.ip,
        sessionId: req.sessionID
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Failed to log frontend error:', error);
      res.status(500).json({ message: 'Logging failed' });
    }
  });

  // Health check endpoint
  app.get('/api/health', async (req, res) => {
    try {
      const dbHealthy = await checkDatabaseHealth();

      const health = {
        status: dbHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        database: dbHealthy ? 'connected' : 'disconnected',
        message: dbHealthy ? 'FMB Database connection established' : 'FMB Database connection failed',
        environment: 'fmb-onprem',
        version: '1.0.0-fmb'
      };

      const statusCode = dbHealthy ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      console.error('Health check failed:', error);
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        message: 'Health check failed',
        error: error?.message || 'Unknown error'
      });
    }
  });

  // Register SAML debug routes
  app.use('/api', fmbSamlRoutes);
  app.use('/api', healthRoutes);
  app.use('/api', samlDebugRoutes);

  const httpServer = createServer(app);
  return httpServer;
}
