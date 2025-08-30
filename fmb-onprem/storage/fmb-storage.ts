import sql from 'mssql';
import { loadFmbOnPremConfig } from '../config/fmb-env.js';
import type { IStorage } from '../../server/storage.js';
import type {
  User,
  UpsertUser,
  InsertProject,
  Project,
  InsertTask,
  Task,
  InsertTimeEntry,
  TimeEntry,
  TimeEntryWithProject,
  TaskWithProject,
  InsertEmployee,
  Employee,
  InsertProjectEmployee,
  ProjectEmployee,
  ProjectWithEmployees,
  Department,
  InsertDepartment,
  DepartmentWithManager,
  Organization,
  InsertOrganization,
  OrganizationWithDepartments,
} from '../../shared/schema.js';

export class FmbStorage implements IStorage {
  private config: any;
  private pool: sql.ConnectionPool | null = null;

  constructor(config: any) {
    this.config = config;
  }

  // IStorage interface implementation - these methods will be implemented below with proper signatures

  // Enhanced logging utility
  private storageLog(operation: string, message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} 🗄️ [FMB-STORAGE] ${operation}: ${message}`;

    if (data) {
      console.log(logMessage, data);
    } else {
      console.log(logMessage);
    }
  }

  async connect(): Promise<boolean> {
    try {
      console.log('🔗 [FMB-STORAGE] Connecting to FMB MS SQL Server...');

      // Load configuration if not provided
      if (!this.config.server) {
        const envConfig = loadFmbOnPremConfig();
        if (!envConfig || !envConfig.database) {
          throw new Error('FMB database configuration not available');
        }
        this.config = {
          server: envConfig.database.server,
          database: envConfig.database.database,
          user: envConfig.database.user,
          password: envConfig.database.password,
          port: envConfig.database.port,
          encrypt: envConfig.database.options.encrypt,
          trustServerCertificate: envConfig.database.options.trustServerCertificate,
          options: envConfig.database.options
        };
      }

      const poolConfig: sql.config = {
        server: this.config.server,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        port: this.config.port,
        options: {
          encrypt: this.config.encrypt,
          trustServerCertificate: this.config.trustServerCertificate,
          enableArithAbort: true,
          connectTimeout: 30000,
          requestTimeout: 30000
        }
      };

      this.pool = new sql.ConnectionPool(poolConfig);

      await this.pool.connect();
      this.storageLog('CONNECT', 'Successfully connected to MS SQL Server');
      return true;
    } catch (error: any) {
      this.storageLog('CONNECT', `Connection failed: ${error?.message}`, error);
      console.error('❌ [FMB-STORAGE] Connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<boolean> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
      this.storageLog('DISCONNECT', 'Disconnected from MS SQL Server');
    }
    return true;
  }

  async execute(query: string, params: any[] = []): Promise<any> {
    if (!this.pool) {
      throw new Error('Database not connected. Call connect() first.');
    }

    try {
      const request = this.pool.request();
      params.forEach((param, index) => {
        request.input(`param${index}`, param);
      });

      this.storageLog('EXECUTE', `Running query: ${query.substring(0, 100)}...`, { paramCount: params.length });
      const result = await request.query(query);
      this.storageLog('EXECUTE', `Query completed successfully`, { recordCount: result.recordset?.length || 0 });
      return result.recordset || result.recordsets;
    } catch (error: any) {
      this.storageLog('EXECUTE', `Query execution failed: ${query.substring(0, 100)}...`, error);
      console.error('❌ [FMB-STORAGE] Query execution failed:', error);
      throw error;
    }
  }

  // User Management Methods
  async getUser(id: string): Promise<User | null> {
    const result = await this.execute('SELECT * FROM users WHERE id = @param0', [id]);
    return result[0] || null;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const existingUser = await this.getUserByEmail(userData.email);

    if (existingUser) {
      // Update existing user
      await this.execute(`
        UPDATE users 
        SET first_name = @param0, last_name = @param1, profile_image_url = @param2, 
            role = @param3, organization_id = @param4, department = @param5, 
            last_login_at = GETDATE(), updated_at = GETDATE()
        WHERE email = @param6
      `, [
        userData.first_name, userData.last_name, userData.profile_image_url,
        userData.role, userData.organization_id, userData.department, userData.email
      ]);
      return await this.getUserByEmail(userData.email) as User;
    } else {
      // Insert new user
      const userId = `user-${Date.now()}`;
      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), userId);
      request.input('email', sql.NVarChar(255), userData.email);
      request.input('firstName', sql.NVarChar(255), userData.first_name);
      request.input('lastName', sql.NVarChar(255), userData.last_name);
      request.input('profileImageUrl', sql.NVarChar(sql.MAX), userData.profile_image_url);
      request.input('role', sql.NVarChar(50), userData.role);
      request.input('organizationId', sql.NVarChar(255), userData.organization_id);
      request.input('department', sql.NVarChar(255), userData.department);

      await request.query(`
        INSERT INTO users (id, email, first_name, last_name, profile_image_url, role, organization_id, department, is_active, created_at, updated_at)
        VALUES (@id, @email, @firstName, @lastName, @profileImageUrl, @role, @organizationId, @department, 1, GETDATE(), GETDATE())
      `);
      return await this.getUser(userId) as User;
    }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const result = await this.execute('SELECT * FROM users WHERE email = @param0', [email]);
    return result[0] || null;
  }

  // Organization Methods
  async getOrganizations(): Promise<Organization[]> {
    // For compatibility, return empty array - full implementation will require userId parameter
    return [];
  }

  async getOrganizationsByUserId(userId: string): Promise<Organization[]> {
    const result = await this.execute(`
      SELECT o.*, 
        (SELECT d.* FROM departments d WHERE d.organization_id = o.id FOR JSON PATH) as departments
      FROM organizations o 
      WHERE o.user_id = @param0
    `, [userId]);

    return result.map((org: any) => ({
      ...org,
      departments: org.departments ? JSON.parse(org.departments) : []
    }));
  }

  async createOrganization(orgData: InsertOrganization): Promise<Organization> {
    const orgId = `org-${Date.now()}`;
    await this.execute(`
      INSERT INTO organizations (id, name, description, user_id, created_at, updated_at)
      VALUES (@param0, @param1, @param2, @param3, GETDATE(), GETDATE())
    `, [orgId, orgData.name, orgData.description, orgData.user_id]);

    const result = await this.execute('SELECT * FROM organizations WHERE id = @param0', [orgId]);
    return result[0];
  }

  // Project Methods  
  async getProjects(): Promise<Project[]> {
    // For compatibility, return empty array - full implementation will require userId parameter
    return [];
  }

  async getProjectsByUser(userId: string): Promise<Project[]> {
    const result = await this.execute('SELECT * FROM projects WHERE user_id = @param0', [userId]);
    return result;
  }

  async getProjectById(id: string): Promise<Project | null> {
    const result = await this.execute('SELECT * FROM projects WHERE id = @param0', [id]);
    return result[0] || null;
  }

  async getProjectsByUserId(userId: string): Promise<ProjectWithEmployees[]> {
    const result = await this.execute(`
      SELECT p.*, 
        (SELECT pe.*, e.first_name, e.last_name, e.employee_id 
         FROM project_employees pe 
         JOIN employees e ON pe.employee_id = e.id 
         WHERE pe.project_id = p.id FOR JSON PATH) as employees
      FROM projects p 
      WHERE p.user_id = @param0
    `, [userId]);

    return result.map((project: any) => ({
      ...project,
      employees: project.employees ? JSON.parse(project.employees) : []
    }));
  }

  async createProject(projectData: InsertProject): Promise<Project> {
    const projectId = `proj-${Date.now()}`;
    const request = this.pool!.request();
    request.input('id', sql.NVarChar(255), projectId);
    request.input('name', sql.NVarChar(255), projectData.name);
    request.input('description', sql.NVarChar(sql.MAX), projectData.description);
    request.input('status', sql.NVarChar(50), projectData.status || 'active');
    request.input('organizationId', sql.NVarChar(255), projectData.organization_id);
    request.input('departmentId', sql.NVarChar(255), projectData.department_id);
    request.input('managerId', sql.NVarChar(255), projectData.manager_id);
    request.input('userId', sql.NVarChar(255), projectData.user_id);
    request.input('startDate', sql.Date, projectData.start_date);
    request.input('endDate', sql.Date, projectData.end_date);
    request.input('budget', sql.Decimal(18, 2), projectData.budget);
    request.input('projectNumber', sql.NVarChar(50), projectData.project_number);
    request.input('isEnterpriseWide', sql.Bit, projectData.is_enterprise_wide || false);
    request.input('isTemplate', sql.Bit, projectData.is_template || false);
    request.input('allowTimeTracking', sql.Bit, projectData.allow_time_tracking !== false);
    request.input('requireTaskSelection', sql.Bit, projectData.require_task_selection || false);
    request.input('enableBudgetTracking', sql.Bit, projectData.enable_budget_tracking || false);
    request.input('enableBilling', sql.Bit, projectData.enable_billing || false);

    await request.query(`
      INSERT INTO projects (id, name, description, status, organization_id, department_id, 
                           manager_id, user_id, start_date, end_date, budget, project_number,
                           is_enterprise_wide, is_template, allow_time_tracking, 
                           require_task_selection, enable_budget_tracking, enable_billing,
                           created_at, updated_at)
      VALUES (@id, @name, @description, @status, @organizationId, @departmentId, @managerId, @userId, 
              @startDate, @endDate, @budget, @projectNumber, @isEnterpriseWide, @isTemplate, 
              @allowTimeTracking, @requireTaskSelection, @enableBudgetTracking, @enableBilling,
              GETDATE(), GETDATE())
    `);

    const result = await this.execute('SELECT * FROM projects WHERE id = @param0', [projectId]);
    return result[0];
  }

  async updateProject(id: string, projectData: Partial<InsertProject>): Promise<Project> {
    const fields = [];
    const params: any[] = [];
    let paramIndex = 0;

    for (const [key, value] of Object.entries(projectData)) {
      if (value !== undefined) {
        // Convert camelCase to snake_case for database columns
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        fields.push(`${dbField} = @param${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    if (fields.length > 0) {
      fields.push('updated_at = GETDATE()');
      params.push(id);

      await this.execute(`
        UPDATE projects 
        SET ${fields.join(', ')} 
        WHERE id = @param${paramIndex}
      `, params);
    }

    return await this.getProjectById(id) as Project;
  }

  async deleteProject(id: string): Promise<void> {
    try {
      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), id);
      await request.query('DELETE FROM projects WHERE id = @id');
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error deleting project:', error);
      throw error;
    }
  }

  // Task Methods
  async getTasks(userId: string): Promise<Task[]> {
    const result = await this.execute(`
      SELECT t.*, p.name as project_name 
      FROM tasks t 
      JOIN projects p ON t.project_id = p.id 
      WHERE p.user_id = @param0
    `, [userId]);
    return result;
  }

  async getTaskById(id: string): Promise<Task | null> {
    const result = await this.execute('SELECT * FROM tasks WHERE id = @param0', [id]);
    return result[0] || null;
  }

  async createTask(taskData: InsertTask): Promise<Task> {
    const taskId = `task-${Date.now()}`;
    await this.execute(`
      INSERT INTO tasks (id, project_id, title, name, description, status, priority, 
                        assigned_to, created_by, due_date, estimated_hours, 
                        created_at, updated_at)
      VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, 
              @param7, @param8, @param9, @param10, GETDATE(), GETDATE())
    `, [
      taskId, taskData.projectId, taskData.title, taskData.name, taskData.description,
      taskData.status || 'pending', taskData.priority || 'medium', taskData.assignedTo,
      taskData.createdBy, taskData.dueDate, taskData.estimatedHours
    ]);

    const result = await this.execute('SELECT * FROM tasks WHERE id = @param0', [taskId]);
    return result[0];
  }

  async updateTask(id: string, taskData: Partial<InsertTask>): Promise<Task> {
    const fields = [];
    const params = [];
    let paramIndex = 0;

    for (const [key, value] of Object.entries(taskData)) {
      if (value !== undefined) {
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        fields.push(`${dbField} = @param${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    if (fields.length > 0) {
      fields.push('updated_at = GETDATE()');
      params.push(id);

      await this.execute(`
        UPDATE tasks 
        SET ${fields.join(', ')} 
        WHERE id = @param${paramIndex}
      `, params);
    }

    return await this.getTaskById(id) as Task;
  }

  async deleteTask(id: string): Promise<void> {
    try {
      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), id);
      await request.query('DELETE FROM tasks WHERE id = @id');
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error deleting task:', error);
      throw error;
    }
  }

  // Time Entry Methods
  async getTimeEntries(userId: string): Promise<TimeEntry[]> {
    const result = await this.execute(`
      SELECT te.*, p.name as project_name, t.title as task_name 
      FROM time_entries te 
      LEFT JOIN projects p ON te.project_id = p.id 
      LEFT JOIN tasks t ON te.task_id = t.id 
      WHERE te.user_id = @param0 
      ORDER BY te.date DESC, te.created_at DESC
    `, [userId]);
    return result;
  }

  async getTimeEntryById(id: string): Promise<TimeEntry | null> {
    const result = await this.execute('SELECT * FROM time_entries WHERE id = @param0', [id]);
    return result[0] || null;
  }

  async getTimeEntriesByUserId(userId: string): Promise<TimeEntry[]> {
    const result = await this.execute('SELECT * FROM time_entries WHERE user_id = @param0', [userId]);
    return result;
  }

  async getTimeEntriesByProjectId(projectId: string): Promise<TimeEntry[]> {
    const result = await this.execute('SELECT * FROM time_entries WHERE project_id = @param0', [projectId]);
    return result;
  }

  async createTimeEntry(timeEntryData: InsertTimeEntry): Promise<TimeEntry> {
    const entryId = `entry-${Date.now()}`;
    await this.execute(`
      INSERT INTO time_entries (id, user_id, project_id, task_id, description, hours, 
                               duration, date, start_time, end_time, status, billable, 
                               is_billable, is_approved, is_manual_entry, is_timer_entry, 
                               is_template, created_at, updated_at)
      VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, 
              @param8, @param9, @param10, @param11, @param12, @param13, @param14, 
              @param15, @param16, GETDATE(), GETDATE())
    `, [
      entryId, timeEntryData.userId, timeEntryData.projectId, timeEntryData.taskId,
      timeEntryData.description, timeEntryData.hours, timeEntryData.duration,
      timeEntryData.date, timeEntryData.startTime, timeEntryData.endTime,
      timeEntryData.status || 'draft', timeEntryData.billable || false,
      timeEntryData.isBillable || false, timeEntryData.isApproved || false,
      timeEntryData.isManualEntry !== false, timeEntryData.isTimerEntry || false,
      timeEntryData.isTemplate || false
    ]);

    const result = await this.execute('SELECT * FROM time_entries WHERE id = @param0', [entryId]);
    return result[0];
  }

  async updateTimeEntry(id: string, timeEntryData: Partial<InsertTimeEntry>): Promise<TimeEntry> {
    const fields = [];
    const params = [];
    let paramIndex = 0;

    for (const [key, value] of Object.entries(timeEntryData)) {
      if (value !== undefined) {
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        fields.push(`${dbField} = @param${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    if (fields.length > 0) {
      fields.push('updated_at = GETDATE()');
      params.push(id);

      await this.execute(`
        UPDATE time_entries 
        SET ${fields.join(', ')} 
        WHERE id = @param${paramIndex}
      `, params);
    }

    return await this.getTimeEntryById(id) as TimeEntry;
  }

  async deleteTimeEntry(id: string): Promise<void> {
    try {
      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), id);
      await request.query('DELETE FROM time_entries WHERE id = @id');
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error deleting time entry:', error);
      throw error;
    }
  }

  // Employee Methods
  async getEmployees(userId: string): Promise<Employee[]> {
    const result = await this.execute('SELECT * FROM employees WHERE user_id = @param0', [userId]);
    return result;
  }

  async getEmployeeById(id: string): Promise<Employee | null> {
    const result = await this.execute('SELECT * FROM employees WHERE id = @param0', [id]);
    return result[0] || null;
  }

  async createEmployee(employeeData: InsertEmployee): Promise<Employee> {
    const empId = `emp-${Date.now()}`;
    await this.execute(`
      INSERT INTO employees (id, employee_id, first_name, last_name, department, user_id, created_at, updated_at)
      VALUES (@param0, @param1, @param2, @param3, @param4, @param5, GETDATE(), GETDATE())
    `, [
      empId, employeeData.employeeId, employeeData.firstName, 
      employeeData.lastName, employeeData.department, employeeData.userId
    ]);

    const result = await this.execute('SELECT * FROM employees WHERE id = @param0', [empId]);
    return result[0];
  }

  async updateEmployee(id: string, employeeData: Partial<InsertEmployee>): Promise<Employee> {
    const fields = [];
    const params = [];
    let paramIndex = 0;

    for (const [key, value] of Object.entries(employeeData)) {
      if (value !== undefined) {
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        fields.push(`${dbField} = @param${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    if (fields.length > 0) {
      fields.push('updated_at = GETDATE()');
      params.push(id);

      await this.execute(`
        UPDATE employees 
        SET ${fields.join(', ')} 
        WHERE id = @param${paramIndex}
      `, params);
    }

    return await this.getEmployeeById(id) as Employee;
  }

  async deleteEmployee(id: string): Promise<void> {
    try {
      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), id);
      await request.query('DELETE FROM employees WHERE id = @id');
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error deleting employee:', error);
      throw error;
    }
  }

  // Department Methods
  async getDepartments(userId: string): Promise<Department[]> {
    const result = await this.execute(`
      SELECT d.*, e.first_name as manager_first_name, e.last_name as manager_last_name 
      FROM departments d 
      LEFT JOIN employees e ON d.manager_id = e.id 
      WHERE d.user_id = @param0
    `, [userId]);
    return result;
  }

  async getDepartmentById(id: string): Promise<Department | null> {
    const result = await this.execute('SELECT * FROM departments WHERE id = @param0', [id]);
    return result[0] || null;
  }

  async createDepartment(deptData: InsertDepartment): Promise<Department> {
    const deptId = `dept-${Date.now()}`;
    await this.execute(`
      INSERT INTO departments (id, name, organization_id, manager_id, description, user_id, created_at, updated_at)
      VALUES (@param0, @param1, @param2, @param3, @param4, @param5, GETDATE(), GETDATE())
    `, [
      deptId, deptData.name, deptData.organizationId, deptData.managerId, 
      deptData.description, deptData.userId
    ]);

    const result = await this.execute('SELECT * FROM departments WHERE id = @param0', [deptId]);
    return result[0];
  }

  async updateDepartment(id: string, deptData: Partial<InsertDepartment>): Promise<Department> {
    const fields = [];
    const params = [];
    let paramIndex = 0;

    for (const [key, value] of Object.entries(deptData)) {
      if (value !== undefined) {
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        fields.push(`${dbField} = @param${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    if (fields.length > 0) {
      fields.push('updated_at = GETDATE()');
      params.push(id);

      await this.execute(`
        UPDATE departments 
        SET ${fields.join(', ')} 
        WHERE id = @param${paramIndex}
      `, params);
    }

    return await this.getDepartmentById(id) as Department;
  }

  async deleteDepartment(id: string): Promise<void> {
    try {
      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), id);
      await request.query('DELETE FROM departments WHERE id = @id');
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error deleting department:', error);
      throw error;
    }
  }

  // Missing IStorage interface methods implementation
  async getUsers(): Promise<User[]> {
    const result = await this.execute('SELECT * FROM users');
    return result;
  }

  async getOrganizationById(id: string): Promise<Organization | null> {
    const result = await this.execute('SELECT * FROM organizations WHERE id = @param0', [id]);
    return result[0] || null;
  }

  async updateOrganization(id: string, org: Partial<InsertOrganization>): Promise<Organization> {
    const fields = [];
    const params = [];
    let paramIndex = 0;

    for (const [key, value] of Object.entries(org)) {
      if (value !== undefined) {
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        fields.push(`${dbField} = @param${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    if (fields.length > 0) {
      fields.push('updated_at = GETDATE()');
      params.push(id);

      await this.execute(`
        UPDATE organizations 
        SET ${fields.join(', ')} 
        WHERE id = @param${paramIndex}
      `, params);
    }

    return await this.getOrganizationById(id) as Organization;
  }

  async deleteOrganization(id: string): Promise<void> {
    try {
      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), id);
      await request.query('DELETE FROM organizations WHERE id = @id');
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error deleting organization:', error);
      throw error;
    }
  }

  // Dashboard Stats
  async getDashboardStats(userId: string): Promise<any> {
    const [hoursResult, projectsResult, employeesResult] = await Promise.all([
      this.execute(`
        SELECT COALESCE(SUM(hours), 0) as total_hours 
        FROM time_entries 
        WHERE user_id = @param0 AND date >= DATEADD(month, -1, GETDATE())
      `, [userId]),
      this.execute('SELECT COUNT(*) as total_projects FROM projects WHERE user_id = @param0', [userId]),
      this.execute('SELECT COUNT(*) as total_employees FROM employees WHERE user_id = @param0', [userId])
    ]);

    // Get recent activity
    const recentActivity = await this.execute(`
      SELECT TOP 10 'time_entry' as type, description, date as created_at 
      FROM time_entries 
      WHERE user_id = @param0 
      UNION ALL 
      SELECT TOP 10 'project' as type, name as description, created_at 
      FROM projects 
      WHERE user_id = @param0 
      ORDER BY created_at DESC
    `, [userId]);

    return {
      totalHours: hoursResult[0]?.total_hours || 0,
      totalProjects: projectsResult[0]?.total_projects || 0,
      totalEmployees: employeesResult[0]?.total_employees || 0,
      recentActivity: recentActivity
    };
  }

  // Helper method to validate and convert UUIDs
  private validateUUID(id: string): string {
    // If it's already a valid GUID format, return as is
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return id;
    }

    // If it's an email or other identifier, use it directly as string
    return id;
  }
}

interface FmbStorageConfig {
  server: string;
  database: string;
  user: string;
  password: string;
  options: {
    port: number;
    enableArithAbort: boolean;
    connectTimeout: number;
    requestTimeout: number;
    encrypt: boolean;
    trustServerCertificate: boolean;
  };
}
