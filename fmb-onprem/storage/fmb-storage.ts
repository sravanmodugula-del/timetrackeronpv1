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
  private pool: sql.ConnectionPool | null = null;
  private config: any;

  constructor(config?: any) {
    this.config = config || loadFmbOnPremConfig().database;
  }

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
      if (this.pool) {
        this.storageLog('CONNECT', 'Already connected to MS SQL Server');
        return true;
      }

      this.storageLog('CONNECT', `Connecting to ${this.config.server}:${this.config.options?.port || 1433}/${this.config.database}`);
      
      this.pool = new sql.ConnectionPool({
        server: this.config.server,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        port: this.config.options?.port || 1433,
        encrypt: this.config.encrypt !== false,
        trustServerCertificate: this.config.trustServerCertificate === true,
        options: {
          enableArithAbort: true,
          connectTimeout: this.config.options?.connectTimeout || 30000,
          requestTimeout: this.config.options?.requestTimeout || 30000,
          ...this.config.options
        }
      });

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

  async getUserByEmail(email: string): Promise<User | null> {
    const result = await this.execute('SELECT * FROM users WHERE email = @param0', [email]);
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
        userData.firstName, userData.lastName, userData.profileImageUrl,
        userData.role, userData.organizationId, userData.department, userData.email
      ]);
      return await this.getUserByEmail(userData.email) as User;
    } else {
      // Insert new user
      const userId = `user-${Date.now()}`;
      await this.execute(`
        INSERT INTO users (id, email, first_name, last_name, profile_image_url, 
                          role, organization_id, department, is_active, created_at, updated_at)
        VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, 1, GETDATE(), GETDATE())
      `, [
        userId, userData.email, userData.firstName, userData.lastName, 
        userData.profileImageUrl, userData.role, userData.organizationId, userData.department
      ]);
      return await this.getUser(userId) as User;
    }
  }

  // Organization Methods
  async getOrganizations(userId: string): Promise<OrganizationWithDepartments[]> {
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
    `, [orgId, orgData.name, orgData.description, orgData.userId]);
    
    const result = await this.execute('SELECT * FROM organizations WHERE id = @param0', [orgId]);
    return result[0];
  }

  // Project Methods
  async getProjects(userId: string): Promise<Project[]> {
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
    await this.execute(`
      INSERT INTO projects (id, name, description, status, organization_id, department_id, 
                           manager_id, user_id, start_date, end_date, budget, project_number,
                           is_enterprise_wide, is_template, allow_time_tracking, 
                           require_task_selection, enable_budget_tracking, enable_billing,
                           created_at, updated_at)
      VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, 
              @param8, @param9, @param10, @param11, @param12, @param13, @param14, 
              @param15, @param16, @param17, GETDATE(), GETDATE())
    `, [
      projectId, projectData.name, projectData.description, projectData.status || 'active',
      projectData.organizationId, projectData.departmentId, projectData.managerId, projectData.userId,
      projectData.startDate, projectData.endDate, projectData.budget, projectData.projectNumber,
      projectData.isEnterpriseWide || false, projectData.isTemplate || false, 
      projectData.allowTimeTracking !== false, projectData.requireTaskSelection || false,
      projectData.enableBudgetTracking || false, projectData.enableBilling || false
    ]);
    
    const result = await this.execute('SELECT * FROM projects WHERE id = @param0', [projectId]);
    return result[0];
  }

  async updateProject(id: string, projectData: Partial<InsertProject>): Promise<Project> {
    const fields = [];
    const params = [];
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

  async deleteProject(id: string): Promise<boolean> {
    await this.execute('DELETE FROM projects WHERE id = @param0', [id]);
    return true;
  }

  // Task Methods
  async getTasks(userId: string): Promise<TaskWithProject[]> {
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

  async getTasksByProjectId(projectId: string): Promise<Task[]> {
    const result = await this.execute('SELECT * FROM tasks WHERE project_id = @param0', [projectId]);
    return result;
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

  async deleteTask(id: string): Promise<boolean> {
    await this.execute('DELETE FROM tasks WHERE id = @param0', [id]);
    return true;
  }

  // Time Entry Methods
  async getTimeEntries(userId: string): Promise<TimeEntryWithProject[]> {
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

  async deleteTimeEntry(id: string): Promise<boolean> {
    await this.execute('DELETE FROM time_entries WHERE id = @param0', [id]);
    return true;
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

  async deleteEmployee(id: string): Promise<boolean> {
    await this.execute('DELETE FROM employees WHERE id = @param0', [id]);
    return true;
  }

  // Department Methods
  async getDepartments(userId: string): Promise<DepartmentWithManager[]> {
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

  async deleteDepartment(id: string): Promise<boolean> {
    await this.execute('DELETE FROM departments WHERE id = @param0', [id]);
    return true;
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
  };
  encrypt: boolean;
  trustServerCertificate: boolean;
}