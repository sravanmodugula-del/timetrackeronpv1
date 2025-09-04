import type { Express } from "express";
import { createServer, type Server } from "http";
import type { RequestHandler } from "express";
// Storage abstraction - use appropriate storage based on environment
import { getFmbStorage } from '../fmb-onprem/config/fmb-database.js';
import { insertProjectSchema, insertTaskSchema, insertTimeEntrySchema, insertEmployeeSchema, insertDepartmentSchema } from "../shared/schema.js";
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
  } catch (error: any) {
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

      // Update last login timestamp
      const activeStorage = getStorage();
      try {
        await activeStorage.updateUser(dbUser.id, { 
          last_login_at: new Date() 
        });
        console.log('🔐 [AUTH] Updated last login timestamp for user:', dbUser.email);
      } catch (updateError) {
        console.error('⚠️ [AUTH] Failed to update last login timestamp:', updateError);
        // Continue even if update fails - don't block authentication
      }

      res.json({
        id: dbUser.id,
        email: dbUser.email,
        firstName: dbUser.first_name,
        lastName: dbUser.last_name,
        role: dbUser.role,
        profileImageUrl: dbUser.profile_image_url,
        lastLoginAt: dbUser.last_login_at,
        createdAt: dbUser.created_at
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

      try {
        // Get user's own projects
        const userProjects = await activeStorage.getProjectsByUserId(userId);

        // Get ALL enterprise-wide projects (regardless of who created them)
        const allProjects = await activeStorage.getProjects();
        const enterpriseProjects = allProjects.filter(p => 
          p.is_enterprise_wide && !userProjects.some(up => up.id === p.id)
        );

        // Combine user projects with ALL enterprise-wide projects
        const combinedProjects = [...userProjects, ...enterpriseProjects];

        console.log(`📁 Projects API: Found ${userProjects.length} user projects and ${enterpriseProjects.length} enterprise projects for user ${userId}`);
        res.json(combinedProjects);
      } catch (error) {
        console.error("Error in getProjectsByUserId:", error);
        // Try fallback method
        try {
          const allProjects = await activeStorage.getProjects();
          // Return user's projects + ALL enterprise-wide projects
          const accessibleProjects = allProjects.filter(p => 
            p.user_id === userId || p.is_enterprise_wide
          );
          res.json(accessibleProjects);
        } catch (fallbackError) {
          console.error("Fallback method also failed:", fallbackError);
          res.status(500).json({ message: "Failed to fetch projects", error: error.message });
        }
      }
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  app.get('/api/projects/:id', isAuthenticated, async (req: any, res: any) => {
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

  app.post('/api/projects', isAuthenticated, async (req: any, res: any) => {
    try {
      const userId = extractUserId(req.user);
      const { name, description, organizationId, departmentId, status, budget, startDate, endDate, projectNumber } = req.body;

      // Validate user session
      if (!userId || typeof userId !== 'string') {
        return res.status(401).json({
          message: "Invalid user session. Please log in again.",
          code: "INVALID_SESSION"
        });
      }

      // Validate request data
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({
          message: "Project name is required",
          code: "INVALID_NAME"
        });
      }

      if (name.trim().length > 255) {
        return res.status(400).json({
          message: "Project name must be less than 255 characters",
          code: "INVALID_NAME"
        });
      }

      if (description && (typeof description !== 'string' || description.length > 2000)) {
        return res.status(400).json({
          message: "Description must be less than 2000 characters",
          code: "INVALID_DESCRIPTION"
        });
      }

      // Validate status if provided
      const validStatuses = ['active', 'inactive', 'completed', 'archived'];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({
          message: "Invalid status",
          code: "INVALID_STATUS",
          validStatuses: validStatuses
        });
      }

      // Validate budget if provided
      if (budget && (typeof budget !== 'number' || budget < 0)) {
        return res.status(400).json({
          message: "Budget must be a positive number",
          code: "INVALID_BUDGET"
        });
      }

      // Validate dates if provided
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (start > end) {
          return res.status(400).json({
            message: "Start date cannot be after end date",
            code: "INVALID_DATE_RANGE"
          });
        }
      }

      const activeStorage = getStorage();

      // Check user permissions
      const user = await activeStorage.getUser(userId);
      if (!user) {
        return res.status(401).json({
          message: "User not found. Please log in again.",
          code: "USER_NOT_FOUND"
        });
      }

      const userRole = user.role || 'employee';
      if (!['admin', 'project_manager'].includes(userRole)) {
        return res.status(403).json({
          message: "Only System Administrators and Project Managers can create projects",
          code: "INSUFFICIENT_PERMISSIONS",
          requiredRole: "admin or project_manager",
          currentRole: userRole
        });
      }

      // Validate optional organization/department references if provided
      if (organizationId) {
        const organization = await activeStorage.getOrganizationById(organizationId);
        if (!organization) {
          return res.status(404).json({
            message: "Organization not found or access denied",
            code: "ORGANIZATION_NOT_FOUND"
          });
        }
      }

      if (departmentId) {
        const department = await activeStorage.getDepartment(departmentId);
        if (!department) {
          return res.status(404).json({
            message: "Department not found",
            code: "DEPARTMENT_NOT_FOUND"
          });
        }

        // If both organization and department are specified, verify they match
        if (organizationId && department.organization_id !== organizationId) {
          return res.status(400).json({
            message: "Department does not belong to the specified organization",
            code: "DEPARTMENT_ORGANIZATION_MISMATCH"
          });
        }
      }

      // Create project
      const projectData = {
        name: name.trim(),
        description: description?.trim() || null,
        status: status || 'active',
        organizationId: organizationId || null,
        departmentId: departmentId || null,
        budget: budget || null,
        startDate: startDate || null,
        endDate: endDate || null,
        projectNumber: projectNumber?.trim() || null,
        user_id: userId
      };

      // Convert camelCase to snake_case for database
      const formattedData = {
        name: projectData.name,
        description: projectData.description,
        status: projectData.status,
        organization_id: projectData.organizationId,
        department_id: projectData.departmentId,
        budget: projectData.budget,
        start_date: projectData.startDate,
        end_date: projectData.endDate,
        project_number: projectData.projectNumber,
        color: req.body.color || '#1976D2',
        user_id: projectData.user_id,
        is_enterprise_wide: !!req.body.isEnterpriseWide, // Assuming isEnterpriseWide is directly in req.body
      };


      console.log(`📁 Creating project: "${projectData.name}" by user: ${user.email} (${userRole})`);

      const project = await activeStorage.createProject(formattedData);

      console.log(`✅ Project created successfully: ${project.id} - "${project.name}"`);

      // Handle employee assignments if provided and not enterprise-wide
      if (req.body.assignedEmployeeIds && Array.isArray(req.body.assignedEmployeeIds) && req.body.assignedEmployeeIds.length > 0 && !req.body.isEnterpriseWide) {
        try {
          console.log(`👥 Assigning ${req.body.assignedEmployeeIds.length} employees to project: ${project.id}`);
          
          // Assign employees to the project
          for (const employeeId of req.body.assignedEmployeeIds) {
            const projEmpData = {
              project_id: project.id,
              employee_id: employeeId,
              user_id: userId
            };
            
            await activeStorage.createProjectEmployee(projEmpData);
            console.log(`✅ Assigned employee ${employeeId} to project ${project.id}`);
          }
          
          console.log(`✅ All employees assigned successfully to project: ${project.id}`);
        } catch (employeeError) {
          console.error(`❌ Error assigning employees to project ${project.id}:`, employeeError);
          // Note: Project was created successfully, but employee assignment failed
          return res.status(201).json({
            ...project,
            message: "Project created successfully, but failed to assign some employees. You can assign employees later from the project details page.",
            warning: "Employee assignment failed"
          });
        }
      }

      res.status(201).json({
        ...project,
        message: "Project created successfully"
      });

    } catch (error: any) {
      console.error(`❌ Error creating project:`, {
        message: error?.message,
        code: error?.code,
        type: error?.constructor?.name
      });

      // Handle specific error types
      if (error?.message?.includes("already exists")) {
        return res.status(409).json({
          message: error.message,
          code: "DUPLICATE_NAME"
        });
      }

      if (error?.message?.includes("organization_id") || error?.message?.includes("Organization")) {
        return res.status(400).json({
          message: "Invalid organization data. Please verify organization exists.",
          code: "INVALID_ORGANIZATION_DATA"
        });
      }

      if (error?.message?.includes("department_id") || error?.message?.includes("Department")) {
        return res.status(400).json({
          message: "Invalid department data. Please verify department exists.",
          code: "INVALID_DEPARTMENT_DATA"
        });
      }

      if (error?.message?.includes("user_id") || error?.message?.includes("User")) {
        return res.status(400).json({
          message: "Invalid user data. Please log in again.",
          code: "INVALID_USER_DATA"
        });
      }

      if (error?.message?.includes("budget") || error?.message?.includes("numeric")) {
        return res.status(400).json({
          message: "Invalid budget value",
          code: "INVALID_BUDGET"
        });
      }

      if (error?.message?.includes("date")) {
        return res.status(400).json({
          message: "Invalid date format",
          code: "INVALID_DATE_FORMAT"
        });
      }

      // Generic server error
      res.status(500).json({
        message: "Failed to create project. Please try again.",
        code: "INTERNAL_ERROR"
      });
    }
  });

  app.patch('/api/projects/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const activeStorage = getStorage();

      console.log('🔧 [API] PATCH project update request:', { id, userId });

      // Validate and map request body to snake_case
      const data = req.body;
      const formattedData = {
        name: data.name?.trim(),
        description: data.description?.trim() || null,
        status: data.status || 'active',
        organization_id: data.organizationId || null,
        department_id: data.departmentId || null,
        budget: data.budget || null,
        start_date: data.startDate || null,
        end_date: data.endDate || null,
        project_number: data.projectNumber?.trim() || null,
        color: data.color || null,
        is_enterprise_wide: !!data.isEnterpriseWide,
      };

      // Filter out undefined values to allow partial updates
      const updateData = Object.fromEntries(
        Object.entries(formattedData).filter(([_, value]) => value !== undefined)
      );

      const project = await activeStorage.updateProject(id, updateData, userId);

      console.log('✅ [API] Project updated successfully:', project.name);
      res.json(project);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid project data", errors: error.errors });
      }
      if (error instanceof Error && error.message.includes('Project not found')) {
        return res.status(404).json({ message: error.message });
      }
      if (error instanceof Error && error.message.includes('Insufficient permissions')) {
        return res.status(403).json({ message: error.message });
      }
      console.error("❌ [API] Error updating project:", error);
      res.status(500).json({ message: "Failed to update project" });
    }
  });

  app.put('/api/projects/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const activeStorage = getStorage();

      console.log('🔧 [API] PUT project update request:', { id, userId });

      // Validate and map request body to snake_case
      const data = req.body;
      const formattedData = {
        name: data.name?.trim(),
        description: data.description?.trim() || null,
        status: data.status || 'active',
        organization_id: data.organizationId || null,
        department_id: data.departmentId || null,
        budget: data.budget || null,
        start_date: data.startDate || null,
        end_date: data.endDate || null,
        project_number: data.projectNumber?.trim() || null,
        color: data.color || null,
        is_enterprise_wide: !!data.isEnterpriseWide,
      };

      const project = await activeStorage.updateProject(id, formattedData, userId);

      console.log('✅ [API] Project updated successfully:', project.name);
      res.json(project);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid project data", errors: error.errors });
      }
      if (error instanceof Error && error.message.includes('Project not found')) {
        return res.status(404).json({ message: error.message });
      }
      console.error("❌ [API] Error updating project:", error);
      res.status(500).json({ message: "Failed to update project" });
    }
  });

  app.delete('/api/projects/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const activeStorage = getStorage();

      console.log('🗑️ [API] Delete project request:', { id, userId });

      const deleted = await activeStorage.deleteProject(id, userId);

      if (!deleted) {
        console.log('❌ [API] Project not found for deletion:', { id, userId });
        return res.status(404).json({ message: "Project not found" });
      }

      console.log('✅ [API] Project deleted successfully:', { id });
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message.includes('Insufficient permissions')) {
        return res.status(403).json({ message: error.message });
      }
      console.error("❌ [API] Error deleting project:", error);
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
      console.log('📋 [API] Fetching project employees for project:', id);
      
      try {
        const employees = await activeStorage.getProjectEmployees(id, userId);
        console.log('📋 [API] Successfully fetched project employees:', employees.length);
        res.json(employees || []);
      } catch (storageError) {
        console.error('📋 [API] Storage error fetching project employees:', storageError);
        // Return empty array instead of error to allow UI to function
        res.json([]);
      }
    } catch (error) {
      console.error("📋 [API] Error fetching project employees:", error);
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

      console.log('👥 [API] Assigning employees to project:', { projectId: id, employeeIds, userId });

      if (!Array.isArray(employeeIds)) {
        return res.status(400).json({ message: "employeeIds must be an array" });
      }

      try {
        await activeStorage.assignEmployeesToProject(id, employeeIds, userId);
        console.log('✅ [API] Employees assigned successfully to project:', id);
        res.status(200).json({ message: "Employees assigned successfully" });
      } catch (assignError) {
        console.error('❌ [API] Error in assignEmployeesToProject:', assignError);
        res.status(500).json({ message: "Failed to assign employees to project", error: assignError.message });
      }
    } catch (error) {
      console.error("❌ [API] Error assigning employees to project:", error);
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
  app.get('/api/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const {projectId } = req.query;
      const activeStorage = getStorage();

      if (!projectId || projectId === "all") {
        // Return all tasks for the user including tasks from enterprise-wide projects
        try {
          // Get user's own tasks
          const userTasks = await activeStorage.getAllUserTasks(userId);

          // Get all projects to find enterprise-wide ones
          const allProjects = await activeStorage.getProjects();
          const enterpriseProjects = allProjects.filter(p => 
            p.is_enterprise_wide && !userTasks.some(task => task.project_id === p.id)
          );

          // Get tasks from enterprise-wide projects
          const enterpriseTasks = [];
          for (const project of enterpriseProjects) {
            const projectTasks = await activeStorage.getTasksByProjectId(project.id);
            for (const task of projectTasks) {
              enterpriseTasks.push({
                ...task,
                project: {
                  id: project.id,
                  name: project.name,
                  color: project.color || '#1976D2'
                }
              });
            }
          }

          // Combine user tasks with enterprise tasks
          const allTasks = [...userTasks, ...enterpriseTasks];
          console.log(`📋 Tasks API: Found ${userTasks.length} user tasks and ${enterpriseTasks.length} enterprise tasks for user ${userId}`);

          res.json(Array.isArray(allTasks) ? allTasks : []);
          return;
        } catch (error) {
          console.error("Error fetching all user tasks:", error);
          res.json([]); // Return empty array on error
          return;
        }
      }

      // Verify user has access to the project (including enterprise-wide projects)
      const allProjects = await activeStorage.getProjects();
      const project = allProjects.find(p => 
        p.id === projectId && (p.user_id === userId || p.is_enterprise_wide)
      );

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const tasks = await activeStorage.getTasksByProjectId(projectId as string);
      res.json(Array.isArray(tasks) ? tasks : []);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get('/api/projects/:projectId/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const {projectId } = req.params;
      const activeStorage = getStorage();

      console.log("📋 [API] Fetching tasks for project:", projectId, "user:", userId);

      // Check if user has access to the project (including enterprise-wide projects)
      const allProjects = await activeStorage.getProjects();
      const project = allProjects.find(p => 
        p.id === projectId && (p.user_id === userId || p.is_enterprise_wide)
      );

      if (!project) {
        console.log("❌ [API] Project not found or access denied:", projectId);
        return res.status(404).json({ message: "Project not found" });
      }

      console.log("✅ [API] Project access verified:", project.name, "enterprise:", project.is_enterprise_wide);

      const tasks = await activeStorage.getTasksByProjectId(projectId);
      console.log("📋 [API] Raw tasks result:", tasks);
      console.log("📋 [API] Found tasks for project:", tasks?.length || 0);

      if (tasks && tasks.length > 0) {
        console.log("📋 [API] Task details:", tasks.map(t => ({
          id: t.id,
          name: t.name,
          status: t.status,
          project_id: t.project_id
        })));
      }

      const finalTasks = Array.isArray(tasks) ? tasks : [];
      console.log("📋 [API] Returning tasks count:", finalTasks.length);

      // Set proper headers
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json(finalTasks);
    } catch (error) {
      console.error("❌ [API] Error fetching project tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks", error: error.message });
    }
  });

  // Create task for specific project
  app.post('/api/projects/:projectId/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const {projectId } = req.params;
      const { name, description, status } = req.body;

      console.log("📝 Project Task Creation Request:", {
        projectId,
        name,
        description,
        status,
        userId
      });

      if (!name?.trim()) {
        return res.status(400).json({ message: "Task name is required" });
      }

      if (!projectId?.trim()) {
        return res.status(400).json({ message: "Project ID is required" });
      }

      const activeStorage = getStorage();

      // Validate project exists and user has access
      const project = await activeStorage.getProject(projectId, userId);
      if (!project) {
        return res.status(404).json({ message: "Project not found or access denied" });
      }

      // Define valid task statuses
      const validStatuses = ['active', 'completed', 'archived'];
      let taskStatus = status || 'active'; // Default to 'active' if not provided

      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({
          message: `Invalid status '${status}'. Valid statuses are: ${validStatuses.join(', ')}.`,
          code: "INVALID_STATUS"
        });
      }

      const taskData = {
        project_id: projectId,
        name: name.trim(),
        title: name.trim(), // Also set title for database compatibility
        description: description?.trim() || "",
        status: taskStatus, // Use the validated or default status
        priority: "medium",
        assigned_to: userId,
        created_by: userId
      };

      const newTask = await activeStorage.createTask(taskData);

      console.log("✅ Task created successfully:", newTask?.id || 'unknown');
      res.json(newTask);
    } catch (error) {
      console.error("❌ Project task creation error:", {
        message: error.message,
        code: error.code,
        stack: error.stack?.split('\n')
      });
      res.status(500).json({
        message: "Failed to create task",
        error: "Internal server error"
      });
    }
  });

  // Get all tasks across projects for cloning (must be before /api/tasks/:id)
  app.get('/api/tasks/all', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();

      console.log("📋 [API] Fetching all user tasks with project info for user:", userId);

      try {
        // Get user's own projects
        const userProjects = await activeStorage.getProjectsByUserId(userId);
        console.log("📋 [API] Found user projects:", userProjects?.length || 0);

        // Get all projects to find enterprise-wide ones
        const allProjects = await activeStorage.getProjects();
        const enterpriseProjects = allProjects.filter(p => 
          p.is_enterprise_wide && !userProjects.some(up => up.id === p.id)
        );
        console.log("📋 [API] Found enterprise projects:", enterpriseProjects?.length || 0);

        // Combine all accessible projects
        const accessibleProjects = [...userProjects, ...enterpriseProjects];
        const allTasksWithProjects = [];

        for (const project of accessibleProjects || []) {
          const projectTasks = await activeStorage.getTasksByProjectId(project.id);
          if (projectTasks && projectTasks.length > 0) {
            // Add project info to each task
            const tasksWithProject = projectTasks.map(task => ({
              ...task,
              project: {
                id: project.id,
                name: project.name,
                color: project.color || '#1976D2'
              }
            }));
            allTasksWithProjects.push(...tasksWithProject);
          }
        }

        console.log("✅ [API] Found tasks with project info:", allTasksWithProjects.length, "from", accessibleProjects.length, "projects");

        if (allTasksWithProjects.length > 0) {
          console.log("📋 [API] Task details with projects:", allTasksWithProjects.map(t => ({
            id: t.id,
            name: t.name,
            status: t.status,
            project_id: t.project_id,
            project_name: t.project?.name,
            is_enterprise: enterpriseProjects.some(ep => ep.id === t.project_id)
          })));
        }

        res.setHeader('Content-Type', 'application/json');
        res.status(200).json(allTasksWithProjects);
      } catch (error) {
        console.error("❌ [API] Error fetching tasks with project info:", error);
        res.status(200).json([]);
      }
    } catch (error) {
      console.error("❌ [API] Error fetching all tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks", error: error.message });
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
      const { name, title, description, status, project_id, projectId } = req.body;

      console.log("📝 Task Creation Request:", {
        name,
        title,
        description,
        status,
        project_id: project_id || projectId,
        userId
      });

      const taskName = name || title;
      const taskProjectId = projectId || project_id;

      // Validate required fields
      if (!taskName || !taskProjectId) {
        return res.status(400).json({
          message: "Name and projectId are required fields",
          received: {
            name: !!taskName,
            projectId: !!taskProjectId
          }
        });
      }

      const activeStorage = getStorage();

      // Verify project exists and user has access
      const project = await activeStorage.getProject(taskProjectId, userId);
      if (!project) {
        return res.status(404).json({
          message: "Project not found or access denied",
          projectId: taskProjectId
        });
      }

      // Define valid task statuses
      const validStatuses = ['active', 'completed', 'archived'];
      let taskStatus = status || 'active'; // Default to 'active' if not provided

      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({
          message: `Invalid status '${status}'. Valid statuses are: ${validStatuses.join(', ')}.`,
          code: "INVALID_STATUS"
        });
      }


      const taskData = {
        project_id: taskProjectId.trim(),
        name: taskName.trim(),
        title: taskName.trim(),
        description: description?.trim() || '',
        status: taskStatus, // Use the validated or default status
        priority: 'medium',
        assigned_to: userId,
        created_by: userId
      };

      const task = await activeStorage.createTask(taskData);
      console.log("✅ Task created successfully:", task?.id || 'unknown');
      res.status(201).json(task);
    } catch (error: any) {
      console.error("❌ Task creation error:", {
        message: error?.message,
        code: error?.code,
        stack: error?.stack?.split('\n').slice(0, 5)
      });

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid task data",
          errors: error.errors
        });
      }

      if (error?.message?.includes('does not exist')) {
        return res.status(404).json({
          message: error.message
        });
      }

      res.status(500).json({
        message: "Failed to create task",
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
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

      // Create explicit update schema for task updates
      const updateTaskSchema = z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(['pending', 'active', 'completed', 'archived']).optional(),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
        projectId: z.string().optional(),
        assignedTo: z.string().optional(),
        dueDate: z.date().optional()
      });

      const validatedData = updateTaskSchema.parse(req.body);

      const task = await activeStorage.updateTask(id, validatedData, userId);

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

      console.log('🗑️ [API] Delete task request:', { id, userId });

      // Check if task exists first
      const task = await activeStorage.getTask(id, userId);
      if (!task) {
        console.log('❌ [API] Task not found for deletion:', { id, userId });
        return res.status(404).json({ message: "Task not found" });
      }

      await activeStorage.deleteTask(id, userId);
      console.log('✅ [API] Task deleted successfully:', { id });
      res.status(204).send();
    } catch (error) {
      console.error("❌ [API] Error deleting task:", error);
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

      console.log('🔄 [CLONE-TASK] Original task data:', {
        id: originalTask.id,
        name: originalTask.name,
        title: originalTask.title,
        description: originalTask.description,
        status: originalTask.status
      });

      // Verify user owns the target project
      const targetProject = await activeStorage.getProject(targetProjectId, userId);
      if (!targetProject) {
        return res.status(403).json({ message: "Access denied to target project" });
      }

      // Clone the task - ensure name/title mapping is correct
      const taskName = originalTask.title || originalTask.name || "Cloned Task";
      const taskDescription = originalTask.description || "";

      console.log('🔄 [CLONE-TASK] Creating cloned task with data:', {
        projectId: targetProjectId,
        name: taskName,
        description: taskDescription,
        status: "active"
      });

      const clonedTask = await activeStorage.createTask({
        project_id: targetProjectId,
        name: taskName,
        title: taskName, // Ensure both name and title are set
        description: taskDescription,
        status: "active", // Reset status to active for cloned tasks
      });

      console.log('✅ [CLONE-TASK] Task cloned successfully:', {
        originalId: originalTask.id,
        clonedId: clonedTask.id,
        name: taskName
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
      const {projectId, startDate, endDate, limit, offset } = req.query;
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

  app.post("/api/time-entries", isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();

      console.log("📝 Time Entry Request Body:", JSON.stringify(req.body, null, 2));

      // Handle manual duration mode by providing default start/end times
      let processedData = { ...req.body, userId };

      // Coerce duration to number if it's a string
      if (processedData.duration && typeof processedData.duration === 'string') {
        const durationValue = parseFloat(processedData.duration);
        if (!isNaN(durationValue)) {
          processedData.duration = durationValue;
        }
      }

      // Coerce hours to number if it's a string
      if (processedData.hours && typeof processedData.hours === 'string') {
        const hoursValue = parseFloat(processedData.hours);
        if (!isNaN(hoursValue)) {
          processedData.hours = hoursValue;
        }
      }

      if (processedData.duration && !processedData.startTime && !processedData.endTime) {
        // For manual duration, set dummy start/end times that match the duration
        processedData.start_time = "09:00";
        const startHour = 9;
        const endHour = startHour + processedData.duration;
        const endMinutes = Math.round((endHour % 1) * 60);
        const endHourInt = Math.floor(endHour);
        processedData.end_time = `${endHourInt.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
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

      console.log("🔧 [API] Update time entry request:", { id, userId, body: req.body });

      // Check if time entry exists first
      const existingEntry = await activeStorage.getTimeEntry(id, userId);
      if (!existingEntry) {
        console.log("❌ [API] Time entry not found:", { id, userId });
        return res.status(404).json({ message: "Time entry not found" });
      }

      // Map frontend camelCase to backend snake_case and ensure proper formatting
      const entryData: any = {
        user_id: userId, // Ensure user_id is always set
      };

      // Map project and task IDs
      if (req.body.projectId) {
        entryData.project_id = req.body.projectId;
      }
      if (req.body.taskId) {
        entryData.task_id = req.body.taskId;
      }

      // Map basic fields
      if (req.body.description !== undefined) {
        entryData.description = req.body.description;
      }
      if (req.body.date) {
        entryData.date = req.body.date;
      }

      // Handle time fields - ensure proper format
      if (req.body.startTime) {
        const startTime = req.body.startTime;
        // Keep HH:MM format - don't append seconds
        entryData.start_time = startTime.includes(":") && startTime.split(":").length >= 2 
          ? startTime.substring(0, 5) : startTime; // Only take HH:MM part
        console.log("🔧 [API] Mapped start_time:", entryData.start_time);
      }

      if (req.body.endTime) {
        const endTime = req.body.endTime;
        // Keep HH:MM format - don't append seconds
        entryData.end_time = endTime.includes(":") && endTime.split(":").length >= 2 
          ? endTime.substring(0, 5) : endTime; // Only take HH:MM part
        console.log("🔧 [API] Mapped end_time:", entryData.end_time);
      }

      // Handle duration and hours
      if (req.body.duration !== undefined) {
        entryData.duration = parseFloat(req.body.duration);
      }
      if (req.body.hours !== undefined) {
        entryData.hours = parseFloat(req.body.hours);
      }

      // Remove undefined fields to allow partial updates
      Object.keys(entryData).forEach(key => {
        if (entryData[key] === undefined) {
          delete entryData[key];
        }
      });

      console.log("🔧 [API] Final entry data for update:", entryData);

      const timeEntry = await activeStorage.updateTimeEntry(id, entryData, userId);

      if (!timeEntry) {
        console.log("❌ [API] Update failed - entry not found after validation:", { id, userId });
        return res.status(404).json({ message: "Time entry not found" });
      }

      console.log("✅ [API] Time entry updated successfully:", { id, timeEntry: timeEntry.id });
      res.json(timeEntry);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("❌ [API] Validation error:", error.errors);
        return res.status(400).json({ message: "Invalid time entry data", errors: error.errors });
      }
      console.error("❌ [API] Error updating time entry:", error);
      res.status(500).json({ message: "Failed to update time entry" });
    }
  });

  app.delete('/api/time-entries/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { id } = req.params;
      const activeStorage = getStorage();

      console.log('🗑️ [API] Delete time entry request:', { id, userId });

      // Check if time entry exists first
      const timeEntry = await activeStorage.getTimeEntry(id, userId);
      if (!timeEntry) {
        console.log('❌ [API] Time entry not found for deletion:', { id, userId });
        return res.status(404).json({ message: "Time entry not found" });
      }

      await activeStorage.deleteTimeEntry(id, userId);
      console.log('✅ [API] Time entry deleted successfully:', { id });
      res.status(204).send();
    } catch (error) {
      console.error("❌ [API] Error deleting time entry:", error);
      res.status(500).json({ message: "Failed to delete time entry" });
    }
  });

  // Dashboard routes - require authentication
  app.get('/api/dashboard/stats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { startDate, endDate } = req.query;
      const activeStorage = getStorage();

      console.log("📊 [DASHBOARD-STATS] Request:", { userId, startDate, endDate });

      const stats = await activeStorage.getDashboardStats(
        userId,
        startDate as string,
        endDate as string
      );

      console.log("📊 [DASHBOARD-STATS] Response:", stats);

      // Ensure we return valid numbers for all stats
      const safeStats = {
        todayHours: Number(stats?.todayHours || 0),
        weekHours: Number(stats?.weekHours || 0),
        monthHours: Number(stats?.monthHours || 0),
        activeProjects: Number(stats?.activeProjects || 0)
      };

      res.json(safeStats);
    } catch (error) {
      console.error("❌ [DASHBOARD-STATS] Error fetching dashboard stats:", error);

      // Return safe defaults on error
      res.json({
        todayHours: 0,
        weekHours: 0,
        monthHours: 0,
        activeProjects: 0
      });
    }
  });

  app.get('/api/dashboard/project-breakdown', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { startDate, endDate } = req.query;
      const activeStorage = getStorage();

      console.log("📊 [PROJECT-BREAKDOWN] Request:", { userId, startDate, endDate });

      const breakdown = await activeStorage.getProjectTimeBreakdown(
        userId,
        startDate as string,
        endDate as string
      );

      console.log("📊 [PROJECT-BREAKDOWN] Response:", breakdown?.length, "projects");

      // Ensure we return a valid array
      const safeBreakdown = Array.isArray(breakdown) ? breakdown : [];

      res.json(safeBreakdown);
    } catch (error) {
      console.error("❌ [PROJECT-BREAKDOWN] Error:", error);
      res.status(500).json({ message: "Failed to fetch project breakdown" });
    }
  });

  app.get('/api/dashboard/recent-activity', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { limit, startDate, endDate } = req.query;
      const activeStorage = getStorage();

      console.log("📊 [RECENT-ACTIVITY] Request:", { userId, limit, startDate, endDate });

      const activity = await activeStorage.getRecentActivity(
        userId,
        limit ? parseInt(limit as string) : undefined,
        startDate as string,
        endDate as string
      );

      console.log("📊 [RECENT-ACTIVITY] Response:", activity);

      // Ensure we return a valid array
      const safeActivity = Array.isArray(activity) ? activity : [];

      res.json(safeActivity);
    } catch (error) {
      console.error("❌ [RECENT-ACTIVITY] Error fetching recent activity:", error);

      // Return empty array on error
      res.json([]);
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
      const activeStorage = getStorage();
      // Get all employees without filtering by userId for employee management
      const employees = await activeStorage.getEmployees();
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
      const { employeeId, firstName, lastName, department, email, phone, position } = req.body;

      // Validate user session
      if (!userId || typeof userId !== 'string') {
        return res.status(401).json({
          message: "Invalid user session. Please log in again.",
          code: "INVALID_SESSION"
        });
      }

      // Validate request data
      if (!employeeId || typeof employeeId !== 'string' || employeeId.trim().length === 0) {
        return res.status(400).json({
          message: "Employee ID is required",
          code: "INVALID_EMPLOYEE_ID"
        });
      }

      if (employeeId.trim().length > 50) {
        return res.status(400).json({
          message: "Employee ID must be less than 50 characters",
          code: "INVALID_EMPLOYEE_ID"
        });
      }

      if (!firstName || typeof firstName !== 'string' || firstName.trim().length === 0) {
        return res.status(400).json({
          message: "First name is required",
          code: "INVALID_FIRST_NAME"
        });
      }

      if (firstName.trim().length > 100) {
        return res.status(400).json({
          message: "First name must be less than 100 characters",
          code: "INVALID_FIRST_NAME"
        });
      }

      if (!lastName || typeof lastName !== 'string' || lastName.trim().length === 0) {
        return res.status(400).json({
          message: "Last name is required",
          code: "INVALID_LAST_NAME"
        });
      }

      if (lastName.trim().length > 100) {
        return res.status(400).json({
          message: "Last name must be less than 100 characters",
          code: "INVALID_LAST_NAME"
        });
      }

      if (!department || typeof department !== 'string' || department.trim().length === 0) {
        return res.status(400).json({
          message: "Department is required",
          code: "INVALID_DEPARTMENT"
        });
      }

      if (department.trim().length > 100) {
        return res.status(400).json({
          message: "Department name must be less than 100 characters",
          code: "INVALID_DEPARTMENT"
        });
      }

      // Validate email format if provided
      if (email && (typeof email !== 'string' || !email.includes('@'))) {
        return res.status(400).json({
          message: "Invalid email format",
          code: "INVALID_EMAIL"
        });
      }

      const activeStorage = getStorage();

      // Check user permissions
      const user = await activeStorage.getUser(userId);
      if (!user) {
        return res.status(401).json({
          message: "User not found. Please log in again.",
          code: "USER_NOT_FOUND"
        });
      }

      const userRole = user.role || 'employee';
      if (!['admin', 'manager'].includes(userRole)) {
        return res.status(403).json({
          message: "Only System Administrators and Managers can create employees",
          code: "INSUFFICIENT_PERMISSIONS",
          requiredRole: "admin or manager",
          currentRole: userRole
        });
      }

      // Create employee
      const employeeData = {
        employee_id: employeeId.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        department: department.trim(),
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        position: position?.trim() || null,
        user_id: userId
      };

      console.log(`👤 Creating employee: ${employeeData.first_name} ${employeeData.last_name} (${employeeData.employee_id}) by user: ${user.email} (${userRole})`);

      const employee = await activeStorage.createEmployee(employeeData);

      console.log(`✅ Employee created successfully: ${employee.id} - ${employee.first_name} ${employee.last_name}`);

      res.status(201).json({
        ...employee,
        message: "Employee created successfully"
      });

    } catch (error: any) {
      console.error(`❌ Error creating employee:`, {
        message: error?.message,
        code: error?.code,
        type: error?.constructor?.name
      });

      // Handle specific error types
      if (error?.message?.includes("already exists")) {
        return res.status(409).json({
          message: error.message,
          code: "DUPLICATE_EMPLOYEE_ID"
        });
      }

      if (error?.message?.includes("user_id") || error?.message?.includes("User")) {
        return res.status(400).json({
          message: "Invalid user data. Please log in again.",
          code: "INVALID_USER_DATA"
        });
      }

      if (error?.message?.includes("department") || error?.message?.includes("Department")) {
        return res.status(400).json({
          message: "Invalid department data. Please verify department exists.",
          code: "INVALID_DEPARTMENT_DATA"
        });
      }

      // Generic server error
      res.status(500).json({
        message: "Failed to create employee. Please try again.",
        code: "INTERNAL_ERROR"
      });
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

      // Return all departments for all users with access to departments page
      const departments = await activeStorage.getDepartments();
      console.log(`📋 Departments API: Found ${departments.length} departments (all departments visible to all users)`);

      // Debug: Log department manager data
      console.log(`🔍 [DEPARTMENTS-API] Manager data sample:`, departments.slice(0, 3).map(d => ({
        id: d.id,
        name: d.name,
        manager_id: d.manager_id,
        manager: d.manager,
        manager_first_name: d.manager_first_name,
        manager_last_name: d.manager_last_name
      })));

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
      const { name, organizationId, description, managerId } = req.body;

      // Validate user session
      if (!userId || typeof userId !== 'string') {
        return res.status(401).json({
          message: "Invalid user session. Please log in again.",
          code: "INVALID_SESSION"
        });
      }

      // Validate request data
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({
          message: "Department name is required",
          code: "INVALID_NAME"
        });
      }

      if (name.trim().length > 255) {
        return res.status(400).json({
          message: "Department name must be less than 255 characters",
          code: "INVALID_NAME"
        });
      }

      if (!organizationId || typeof organizationId !== 'string') {
        return res.status(400).json({
          message: "Organization ID is required",
          code: "INVALID_ORGANIZATION_ID"
        });
      }

      if (description && (typeof description !== 'string' || description.length > 1000)) {
        return res.status(400).json({
          message: "Description must be less than 1000 characters",
          code: "INVALID_DESCRIPTION"
        });
      }

      const activeStorage = getStorage();

      // Check user permissions
      const user = await activeStorage.getUser(userId);
      if (!user) {
        return res.status(401).json({
          message: "User not found. Please log in again.",
          code: "USER_NOT_FOUND"
        });
      }

      const userRole = user.role || 'employee';
      if (userRole !== 'admin') {
        return res.status(403).json({
          message: "Only System Administrators can create departments",
          code: "INSUFFICIENT_PERMISSIONS",
          requiredRole: "admin",
          currentRole: userRole
        });
      }

      // Verify organization exists and user has access
      const organization = await activeStorage.getOrganizationById(organizationId);
      if (!organization) {
        return res.status(404).json({
          message: "Organization not found or access denied",
          code: "ORGANIZATION_NOT_FOUND"
        });
      }

      // Validate manager if provided
      if (managerId) {
        // First try to get as employee, then as user
        let manager = await activeStorage.getEmployeeById(managerId);
        if (!manager) {
          manager = await activeStorage.getUser(managerId);
        }
        if (!manager) {
          return res.status(404).json({
            message: "Manager not found",
            code: "MANAGER_NOT_FOUND"
          });
        }
      }

      // Create department
      const departmentData = {
        name: name.trim(),
        organization_id: organizationId,
        description: description?.trim() || null,
        manager_id: managerId || null,
        user_id: userId
      };

      console.log(`🏢 Creating department: "${departmentData.name}" in organization: ${organization.name} by user: ${user.email}`);

      const department = await activeStorage.createDepartment(departmentData);

      console.log(`✅ Department created successfully: ${department.id} - "${department.name}"`);

      res.status(201).json({
        ...department,
        message: "Department created successfully"
      });

    } catch (error: any) {
      console.error(`❌ Error creating department:`, {
        message: error?.message,
        code: error?.code,
        type: error?.constructor?.name
      });

      // Handle specific error types
      if (error?.message?.includes("already exists")) {
        return res.status(409).json({
          message: error.message,
          code: "DUPLICATE_NAME"
        });
      }

      if (error?.message?.includes("organization_id") || error?.message?.includes("Organization")) {
        return res.status(400).json({
          message: "Invalid organization data. Please verify organization exists.",
          code: "INVALID_ORGANIZATION_DATA"
        });
      }

      if (error?.message?.includes("manager_id") || error?.message?.includes("Manager")) {
        return res.status(400).json({
          message: "Invalid manager data. Please verify manager exists.",
          code: "INVALID_MANAGER_DATA"
        });
      }

      // Generic server error
      res.status(500).json({
        message: "Failed to create department. Please try again.",
        code: "INTERNAL_ERROR"
      });
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

      console.log('🗑️ [API] Delete department request:', { id, userId, userRole });

      // Only system administrators can delete departments
      if (userRole !== 'admin') {
        return res.status(403).json({ message: "Insufficient permissions to delete departments" });
      }

      const success = await activeStorage.deleteDepartment(id, userId);

      if (!success) {
        console.log('❌ [API] Department not found for deletion:', { id, userId });
        return res.status(404).json({ message: "Department not found" });
      }

      console.log('✅ [API] Department deleted successfully:', { id });
      res.json({ message: "Department deleted successfully" });
    } catch (error) {
      console.error("❌ [API] Error deleting department:", error);
      res.status(500).json({ message: "Failed to delete department" });
    }
  });

  app.post("/api/departments/:id/manager", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { managerId } = req.body;
      const userId = extractUserId(req.user);
      const activeStorage = getStorage();

      console.log('🏢 [API] Assigning manager to department:', { departmentId: id, managerId, userId });

      // Update the department's manager_id directly
      const request = (activeStorage as any).pool.request();
      request.input('departmentId', (activeStorage as any).sql.NVarChar(255), id);
      request.input('managerId', (activeStorage as any).sql.NVarChar(255), managerId || null);

      await request.query(`
        UPDATE departments 
        SET manager_id = @managerId, updated_at = GETDATE() 
        WHERE id = @departmentId
      `);

      console.log('✅ [API] Manager assigned successfully to department:', id);
      res.json({ message: "Manager assigned successfully" });
    } catch (error) {
      console.error("❌ [API] Error assigning manager:", error);
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

      // Users are already mapped in the storage layer
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

      // Check if storage has getAllOrganizations method, fallback to getOrganizationsByUserId
      let organizations;
      if ('getAllOrganizations' in activeStorage && typeof activeStorage.getAllOrganizations === 'function') {
        organizations = await (activeStorage as any).getAllOrganizations();
      } else {
        // Fallback: get all organizations by querying without user filter
        organizations = await activeStorage.getOrganizationsByUserId(userId);
      }

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

  // Create organization
  app.post('/api/organizations', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { name, description } = req.body;

      // Validate user session
      if (!userId || typeof userId !== 'string') {
        return res.status(401).json({
          message: "Invalid user session. Please log in again.",
          code: "INVALID_SESSION"
        });
      }

      // Validate request data
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({
          message: "Organization name is required",
          code: "INVALID_NAME"
        });
      }

      if (name.trim().length > 255) {
        return res.status(400).json({
          message: "Organization name must be less than 255 characters",
          code: "INVALID_NAME"
        });
      }

      if (description && (typeof description !== 'string' || description.length > 1000)) {
        return res.status(400).json({
          message: "Description must be less than 1000 characters",
          code: "INVALID_DESCRIPTION"
        });
      }

      const activeStorage = getStorage();

      // Check user permissions
      const user = await activeStorage.getUser(userId);
      if (!user) {
        return res.status(401).json({
          message: "User not found. Please log in again.",
          code: "USER_NOT_FOUND"
        });
      }

      const userRole = user.role || 'employee';
      if (userRole !== 'admin') {
        return res.status(403).json({
          message: "Only System Administrators can create organizations",
          code: "INSUFFICIENT_PERMISSIONS",
          requiredRole: "admin",
          currentRole: userRole
        });
      }

      // Create organization
      const organizationData = {
        name: name.trim(),
        description: description?.trim() || null,
        user_id: userId
      };

      console.log(`🏢 Creating organization: "${organizationData.name}" by user: ${user.email}`);

      const organization = await activeStorage.createOrganization(organizationData);

      console.log(`✅ Organization created successfully: ${organization.id} - "${organization.name}"`);

      res.status(201).json({
        ...organization,
        message: "Organization created successfully"
      });

    } catch (error: any) {
      console.error(`❌ Error creating organization:`, {
        message: error?.message,
        code: error?.code,
        type: error?.constructor?.name
      });

      // Handle specific error types
      if (error?.message?.includes("already exists")) {
        return res.status(409).json({
          message: error.message,
          code: "DUPLICATE_NAME"
        });
      }

      if (error?.message?.includes("user_id") || error?.message?.includes("User")) {
        return res.status(400).json({
          message: "Invalid user data. Please log in again.",
          code: "INVALID_USER_DATA"
        });
      }

      // Generic server error
      res.status(500).json({
        message: "Failed to create organization. Please try again.",
        code: "INTERNAL_ERROR"
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

      console.log('🗑️ [API] Delete organization request:', { id, userId, userRole });

      // Only system administrators can delete organizations
      if (userRole !== 'admin') {
        return res.status(403).json({ message: "Insufficient permissions to delete organizations" });
      }

      const success = await activeStorage.deleteOrganization(id, userId);

      if (!success) {
        console.log('❌ [API] Organization not found for deletion:', { id, userId });
        return res.status(404).json({ message: "Organization not found" });
      }

      console.log('✅ [API] Organization deleted successfully:', { id });
      res.json({ message: "Organization deleted successfully" });
    } catch (error) {
      console.error("❌ [API] Error deleting organization:", error);
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

      console.log('📊 [REPORTS] Fetching time entries for project:', projectId, 'user:', userId);

      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const currentUser = await activeStorage.getUser(userId);

      // Check if user has permission to view reports
      const allowedRoles = ['project_manager', 'admin', 'manager'];
      if (!currentUser || !allowedRoles.includes(currentUser.role || 'employee')) {
        return res.status(403).json({ message: "Insufficient permissions to view reports" });
      }

      console.log('📊 [REPORTS] User has permission, role:', currentUser.role);

      // Verify project exists and user has access
      const project = await activeStorage.getProject(projectId, userId);
      if (!project) {
        console.log('📊 [REPORTS] Project not found or access denied:', projectId);
        return res.status(404).json({ message: "Project not found or access denied" });
      }

      console.log('📊 [REPORTS] Project found:', project.name);

      // Get time entries for the project - use the standard getTimeEntries method with project filter
      const timeEntries = await activeStorage.getTimeEntries(userId, {
        projectId: projectId,
        // Don't limit by date range for reports - show all entries
      });

      console.log('📊 [REPORTS] Found time entries:', timeEntries?.length || 0);

      // Transform entries to include employee information for reports
      const transformedEntries = timeEntries.map(entry => ({
        ...entry,
        employee: {
          id: entry.user_id || userId,
          first_name: currentUser.first_name || 'Unknown',
          last_name: currentUser.last_name || 'User'
        },
        task: entry.task ? {
          id: entry.task.id,
          name: entry.task.name || entry.task.title,
          description: entry.task.description,
          status: entry.task.status
        } : null
      }));

      console.log('📊 [REPORTS] Transformed entries:', transformedEntries.length);

      res.json(transformedEntries);
    } catch (error) {
      console.error("📊 [REPORTS] Error fetching project time entries:", error);
      res.status(500).json({ message: "Failed to fetch project time entries" });
    }
  });

  // Debug endpoint to check task-project relationships
  app.get('/api/debug/tasks/:projectId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const { projectId } = req.params;
      const activeStorage = getStorage();

      console.log("🔧 [DEBUG] Debug endpoint called for project:", projectId, "user:", userId);

      const project = await activeStorage.getProject(projectId, userId);
      console.log("🔧 [DEBUG] Project result:", project);

      const tasks = await activeStorage.getTasksByProjectId(projectId);
      console.log("🔧 [DEBUG] Tasks result:", tasks);

      // Also test direct database query
      const pool = (activeStorage as any).pool;
      if (pool) {
        const request = pool.request();
        request.input('projectId', (activeStorage as any).sql.NVarChar, projectId);
        const directResult = await request.query(`
          SELECT COUNT(*) as task_count FROM tasks WHERE project_id = @projectId
        `);
        console.log("🔧 [DEBUG] Direct task count query:", directResult.recordset[0]);

        const allTasksResult = await request.query(`
          SELECT id, name, title, project_id, status FROM tasks WHERE project_id = @projectId
        `);
        console.log("🔧 [DEBUG] All tasks in database for project:", allTasksResult.recordset);
      }

      res.json({
        userId,
        projectId,
        project: project ? { id: project.id, name: project.name } : null,
        tasksCount: tasks?.length || 0,
        tasks: tasks?.map(t => ({
          id: t.id,
          name: t.name,
          status: t.status,
          project_id: t.project_id
        })) || [],
        debug: {
          directDatabaseCheck: "See server logs for details"
        }
      });
    } catch (error) {
      console.error("🔧 [DEBUG] Debug endpoint error:", error);
      res.status(500).json({ error: error.message });
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
