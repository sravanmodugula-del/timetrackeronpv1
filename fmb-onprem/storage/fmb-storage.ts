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
          trustServerCertificate: true, // Trust all certificates
          enableArithAbort: true,
          requestTimeout: 30000,
          connectionTimeout: 30000,
          validateBulkLoadParameters: false,
          cryptoCredentialsDetails: {
            rejectUnauthorized: false, // Allow self-signed certificates
            secureProtocol: 'TLSv1_2_method' // Use TLS 1.2
          }
        }
      };

      // Ensure proper SSL certificate trust configuration
      const connectionConfig = {
        ...this.config,
        options: {
          ...this.config.options,
          trustServerCertificate: this.config.trustServerCertificate || true // Force trust for on-premises
        }
      };

      this.pool = new sql.ConnectionPool(connectionConfig);

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
      const request = this.pool.request(); // Use this.pool.request() directly
      
      // Add parameters with explicit types to prevent NULL insertion
      params.forEach((param, index) => {
        const paramName = `param${index}`;
        
        // Determine appropriate SQL type based on the parameter value
        if (param === null || param === undefined) {
          request.input(paramName, sql.NVarChar(255), null);
        } else if (typeof param === 'string') {
          request.input(paramName, sql.NVarChar(param.length > 255 ? sql.MAX : 255), param);
        } else if (typeof param === 'number') {
          if (Number.isInteger(param)) {
            request.input(paramName, sql.Int, param);
          } else {
            request.input(paramName, sql.Decimal(18, 2), param);
          }
        } else if (typeof param === 'boolean') {
          request.input(paramName, sql.Bit, param);
        } else if (param instanceof Date) {
          request.input(paramName, sql.DateTime2, param);
        } else {
          // Default to string for other types
          request.input(paramName, sql.NVarChar(sql.MAX), String(param));
        }
      });

      this.storageLog('EXECUTE', `Running query: ${query.substring(0, 100)}...`, { paramCount: params.length });
      
      // Debug log to show actual parameter values being passed
      console.log(`🔍 [EXECUTE-DEBUG] Parameter values:`, params.map((param, index) => ({
        [`@param${index}`]: param,
        type: typeof param,
        isNull: param === null || param === undefined
      })));
      
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

  // Organization Methods with enhanced validation and error handling
  async getOrganizations(userId?: string): Promise<Organization[]> {
    try {
      this.storageLog('GET_ORGS', 'Fetching organizations', { userId });

      if (userId) {
        return await this.getOrganizationsByUserId(userId);
      }

      // Get all organizations with basic department count for performance
      const result = await this.execute(`
        SELECT o.*, 
               (SELECT COUNT(*) FROM departments d WHERE d.organization_id = o.id) as department_count
        FROM organizations o 
        ORDER BY o.created_at DESC
      `);

      this.storageLog('GET_ORGS', 'Organizations fetched successfully', { count: result.length });
      return result;
    } catch (error) {
      this.storageLog('GET_ORGS', 'Failed to fetch organizations', { error: error.message });
      throw new Error(`Failed to fetch organizations: ${error.message}`);
    }
  }

  async getOrganizationsByUserId(userId: string): Promise<Organization[]> {
    try {
      // Input validation
      if (!userId || typeof userId !== 'string') {
        throw new Error('Valid userId is required');
      }

      this.storageLog('GET_USER_ORGS', 'Fetching organizations for user', { userId });

      // Use parameterized query for better performance and security
      const request = this.pool!.request();
      request.input('userId', sql.NVarChar(255), userId);

      const result = await request.query(`
        SELECT o.*, 
          (SELECT d.id, d.name, d.description, d.manager_id 
           FROM departments d 
           WHERE d.organization_id = o.id 
           FOR JSON PATH) as departments
        FROM organizations o 
        WHERE o.user_id = @userId
        ORDER BY o.created_at DESC
      `);

      const organizations = result.recordset.map((org: any) => ({
        ...org,
        departments: org.departments ? JSON.parse(org.departments) : []
      }));

      this.storageLog('GET_USER_ORGS', 'User organizations fetched successfully', { 
        userId, 
        count: organizations.length 
      });

      return organizations;
    } catch (error) {
      this.storageLog('GET_USER_ORGS', 'Failed to fetch user organizations', { 
        userId, 
        error: error.message 
      });
      throw new Error(`Failed to fetch organizations for user: ${error.message}`);
    }
  }

  async createOrganization(orgData: { name: string; description?: string; user_id: string }) {
    try {
      // Early validation
      if (!orgData || typeof orgData !== 'object') {
        throw new Error('Invalid organization data provided');
      }

      if (!orgData.user_id || typeof orgData.user_id !== 'string' || orgData.user_id.trim() === '') {
        throw new Error('Valid user ID is required for organization creation');
      }

      const orgId = `org-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Sanitize inputs
      const sanitizedName = orgData.name?.trim();
      const sanitizedDescription = orgData.description?.trim() || null;
      const sanitizedUserId = orgData.user_id.trim();

      if (!sanitizedName) {
        throw new Error('Organization name cannot be empty');
      }

      this.storageLog('CREATE_ORG', 'Starting organization creation', {
        id: orgId,
        name: sanitizedName,
        user_id: sanitizedUserId,
        hasDescription: !!sanitizedDescription,
        rawData: {
          nameType: typeof orgData.name,
          userIdType: typeof orgData.user_id,
          userIdLength: orgData.user_id?.length
        }
      });

      // DEBUG: Log all input parameters before database operation
      console.log(`🔍 [CREATE_ORG-DEBUG] Input Parameters Analysis:`, {
        originalInput: JSON.stringify(orgData, null, 2),
        sanitizedValues: {
          name: sanitizedName,
          description: sanitizedDescription,
          user_id: sanitizedUserId
        },
        validation: {
          nameIsString: typeof sanitizedName === 'string',
          nameNotEmpty: sanitizedName && sanitizedName.length > 0,
          userIdIsString: typeof sanitizedUserId === 'string',
          userIdNotEmpty: sanitizedUserId && sanitizedUserId.length > 0,
          descriptionValidOrNull: sanitizedDescription === null || typeof sanitizedDescription === 'string'
        }
      });

      // Verify user exists first
      const userExists = await this.execute('SELECT id FROM users WHERE id = @param0', [sanitizedUserId]);
      if (!userExists || userExists.length === 0) {
        throw new Error(`User with ID ${sanitizedUserId} does not exist`);
      }

      this.storageLog('CREATE_ORG', 'User validation successful', {
        user_id: sanitizedUserId,
        userFound: true
      });

      // Use the working execute method that handles parameters correctly
      this.storageLog('CREATE_ORG', 'Executing INSERT with validated parameters', {
        id: orgId,
        name: sanitizedName,
        description: sanitizedDescription,
        user_id: sanitizedUserId,
        method: 'execute_method'
      });

      console.log(`🔍 [CREATE_ORG-SQL] Using execute method with parameters:`, {
        parameters: [orgId, sanitizedName, sanitizedDescription, sanitizedUserId],
        validation: {
          allParametersPresent: !!(orgId && sanitizedName && sanitizedUserId),
          userIdValid: sanitizedUserId && sanitizedUserId.trim().length > 0
        }
      });

      // Use the execute method that works for other queries
      await this.execute(`
        INSERT INTO organizations (id, name, description, user_id, created_at, updated_at)
        VALUES (@param0, @param1, @param2, @param3, GETDATE(), GETDATE())
      `, [orgId, sanitizedName, sanitizedDescription, sanitizedUserId]);

      this.storageLog('CREATE_ORG', 'INSERT query executed successfully', {
        id: orgId
      });

      // Fetch the created organization to verify
      const fetchResult = await this.execute('SELECT * FROM organizations WHERE id = @param0', [orgId]);

      if (!fetchResult || fetchResult.length === 0) {
        throw new Error('Organization was not created successfully');
      }

      this.storageLog('CREATE_ORG', 'Organization creation completed successfully', {
        id: orgId,
        name: fetchResult[0].name,
        user_id: fetchResult[0].user_id
      });

      return fetchResult[0];
      } catch (insertError) {
        this.storageLog('CREATE_ORG', 'Database INSERT operation failed', {
          error: insertError.message,
          errorCode: insertError.code,
          errorNumber: insertError.number,
          orgData: {
            id: orgId,
            name: sanitizedName,
            user_id: sanitizedUserId,
            hasDescription: !!sanitizedDescription
          },
          sqlState: insertError.state,
          lineNumber: insertError.lineNumber
        });
        throw insertError;
      }
    } catch (error) {
      this.storageLog('CREATE_ORG', 'Organization creation failed', { 
        orgData: { 
          name: orgData?.name || '[MISSING]',
          user_id: orgData?.user_id ? `[PRESENT: ${orgData.user_id.substring(0, 10)}...]` : '[MISSING]',
          dataType: typeof orgData
        }, 
        error: error.message,
        errorType: error.constructor.name
      });
      throw new Error(`Failed to create organization: ${error.message}`);
    }
  }

  // Project Methods  
  async getProjects(userId?: string): Promise<Project[]> {
    if (userId) {
      const result = await this.getProjectsByUserId(userId);
      return result;
    }
    const result = await this.execute('SELECT * FROM projects ORDER BY created_at DESC');
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

    // Log the projectData to debug
    this.storageLog('CREATE_PROJECT', 'Creating project with data', {
      projectId,
      name: projectData.name,
      user_id: projectData.user_id,
      organization_id: projectData.organization_id
    });

    const request = this.pool!.request();
    request.input('id', sql.NVarChar(255), projectId);
    request.input('name', sql.NVarChar(255), projectData.name);
    request.input('description', sql.NVarChar(sql.MAX), projectData.description || null);
    request.input('status', sql.NVarChar(50), projectData.status || 'active');
    request.input('organizationId', sql.NVarChar(255), projectData.organization_id || null);
    request.input('departmentId', sql.NVarChar(255), projectData.department_id || null);
    request.input('managerId', sql.NVarChar(255), projectData.manager_id || null);
    request.input('userId', sql.NVarChar(255), projectData.user_id);
    request.input('startDate', sql.Date, projectData.start_date || null);
    request.input('endDate', sql.Date, projectData.end_date || null);
    request.input('budget', sql.Decimal(18, 2), projectData.budget || null);
    request.input('projectNumber', sql.NVarChar(50), projectData.project_number || null);
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
  async getTasks(): Promise<Task[]> {
    const result = await this.execute(`
      SELECT t.*, p.name as project_name 
      FROM tasks t 
      JOIN projects p ON t.project_id = p.id
    `);
    return result;
  }

  async getTasksByUserId(userId: string): Promise<Task[]> {
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
    const insertData = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      project_id: taskData.project_id,
      title: taskData.title,
      name: taskData.name || taskData.title,
      description: taskData.description,
      status: taskData.status || 'pending',
      priority: taskData.priority || 'medium',
      assigned_to: taskData.assigned_to,
      created_by: taskData.created_by,
      due_date: taskData.due_date,
      estimated_hours: taskData.estimated_hours,
    };
    await this.execute(`
      INSERT INTO tasks (id, project_id, title, name, description, status, priority, 
                        assigned_to, created_by, due_date, estimated_hours, 
                        created_at, updated_at)
      VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, 
              @param7, @param8, @param9, @param10, GETDATE(), GETDATE())
    `, [
      insertData.id, insertData.project_id, insertData.title, insertData.name, insertData.description,
      insertData.status, insertData.priority, insertData.assigned_to,
      insertData.created_by, insertData.due_date, insertData.estimated_hours
    ]);

    const result = await this.execute('SELECT * FROM tasks WHERE id = @param0', [insertData.id]);
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
  async getTimeEntries(): Promise<TimeEntry[]> {
    const result = await this.execute(`
      SELECT te.*, p.name as project_name, t.title as task_name 
      FROM time_entries te 
      LEFT JOIN projects p ON te.project_id = p.id 
      LEFT JOIN tasks t ON te.task_id = t.id 
      ORDER BY te.date DESC, te.created_at DESC
    `);
    return result;
  }

  async getTimeEntriesByUserId(userId: string): Promise<TimeEntry[]> {
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

  async getTimeEntriesByProjectId(projectId: string): Promise<TimeEntry[]> {
    const result = await this.execute('SELECT * FROM time_entries WHERE project_id = @param0', [projectId]);
    return result;
  }

  async createTimeEntry(timeEntryData: InsertTimeEntry): Promise<TimeEntry> {
    const insertData = {
      id: `te-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      user_id: timeEntryData.user_id,
      project_id: timeEntryData.project_id,
      task_id: timeEntryData.task_id,
      description: timeEntryData.description,
      hours: timeEntryData.hours,
      duration: timeEntryData.duration || timeEntryData.hours,
      date: timeEntryData.date,
      start_time: timeEntryData.start_time,
      end_time: timeEntryData.end_time,
      status: timeEntryData.status || 'draft',
      billable: timeEntryData.billable || false,
      is_billable: timeEntryData.is_billable || false,
      is_approved: timeEntryData.is_approved || false,
      is_manual_entry: timeEntryData.is_manual_entry !== false,
      is_timer_entry: timeEntryData.is_timer_entry || false,
      is_template: timeEntryData.is_template || false
    };
    await this.execute(`
      INSERT INTO time_entries (id, user_id, project_id, task_id, description, hours, 
                               duration, date, start_time, end_time, status, billable, 
                               is_billable, is_approved, is_manual_entry, is_timer_entry, 
                               is_template, created_at, updated_at)
      VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, 
              @param8, @param9, @param10, @param11, @param12, @param13, @param14, 
              @param15, @param16, GETDATE(), GETDATE())
    `, [
      insertData.id, insertData.user_id, insertData.project_id, insertData.task_id,
      insertData.description, insertData.hours, insertData.duration,
      insertData.date, insertData.start_time, insertData.end_time,
      insertData.status, insertData.billable,
      insertData.is_billable, insertData.is_approved,
      insertData.is_manual_entry, insertData.is_timer_entry,
      insertData.is_template
    ]);

    const result = await this.execute('SELECT * FROM time_entries WHERE id = @param0', [insertData.id]);
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
  async getEmployees(userId?: string): Promise<Employee[]> {
    if (userId) {
      return await this.getEmployeesByUserId(userId);
    }
    const result = await this.execute('SELECT * FROM employees ORDER BY created_at DESC');
    return result;
  }

  async getEmployeesByUserId(userId: string): Promise<Employee[]> {
    const result = await this.execute('SELECT * FROM employees WHERE user_id = @param0', [userId]);
    return result;
  }

  async getEmployeeById(id: string): Promise<Employee | null> {
    const result = await this.execute('SELECT * FROM employees WHERE id = @param0', [id]);
    return result[0] || null;
  }

  async createEmployee(employeeData: InsertEmployee): Promise<Employee> {
    const insertData = {
      id: `emp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      employee_id: employeeData.employee_id,
      first_name: employeeData.first_name,
      last_name: employeeData.last_name,
      department: employeeData.department,
      user_id: employeeData.user_id
    };
    await this.execute(`
      INSERT INTO employees (id, employee_id, first_name, last_name, department, user_id, created_at, updated_at)
      VALUES (@param0, @param1, @param2, @param3, @param4, @param5, GETDATE(), GETDATE())
    `, [
      insertData.id, insertData.employee_id, insertData.first_name, 
      insertData.last_name, insertData.department, insertData.user_id
    ]);

    const result = await this.execute('SELECT * FROM employees WHERE id = @param0', [insertData.id]);
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
  async getDepartments(): Promise<Department[]> {
    const result = await this.execute(`
      SELECT d.*, e.first_name as manager_first_name, e.last_name as manager_last_name 
      FROM departments d 
      LEFT JOIN employees e ON d.manager_id = e.id
    `);
    return result;
  }

  async getDepartmentsByUserId(userId: string): Promise<Department[]> {
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
    const insertData = {
      id: `dept-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: deptData.name,
      organization_id: deptData.organization_id,
      manager_id: deptData.manager_id,
      user_id: deptData.user_id,
      description: deptData.description
    };
    await this.execute(`
      INSERT INTO departments (id, name, organization_id, manager_id, description, user_id, created_at, updated_at)
      VALUES (@param0, @param1, @param2, @param3, @param4, @param5, GETDATE(), GETDATE())
    `, [
      insertData.id, insertData.name, insertData.organization_id, insertData.manager_id, 
      insertData.description, insertData.user_id
    ]);

    const result = await this.execute('SELECT * FROM departments WHERE id = @param0', [insertData.id]);
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

  async getUserById(id: string): Promise<User | null> {
    return await this.getUser(id);
  }

  async createUser(userData: UpsertUser): Promise<User> {
    return await this.upsertUser(userData);
  }

  async updateUser(id: string, userData: Partial<UpsertUser>): Promise<User> {
    const fields = [];
    const params = [];
    let paramIndex = 0;

    for (const [key, value] of Object.entries(userData)) {
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
        UPDATE users 
        SET ${fields.join(', ')} 
        WHERE id = @param${paramIndex}
      `, params);
    }

    return await this.getUser(id) as User;
  }

  async deleteUser(id: string): Promise<void> {
    try {
      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), id);
      await request.query('DELETE FROM users WHERE id = @id');
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error deleting user:', error);
      throw error;
    }
  }

  async getOrganizationById(id: string): Promise<Organization | null> {
    try {
      // Input validation
      if (!id || typeof id !== 'string') {
        throw new Error('Valid organization ID is required');
      }

      this.storageLog('GET_ORG_BY_ID', 'Fetching organization by ID', { id });

      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), id);

      const result = await request.query(`
        SELECT o.*, 
               (SELECT COUNT(*) FROM departments d WHERE d.organization_id = o.id) as department_count,
               (SELECT COUNT(*) FROM projects p WHERE p.organization_id = o.id) as project_count
        FROM organizations o 
        WHERE o.id = @id
      `);

      const organization = result.recordset[0] || null;

      this.storageLog('GET_ORG_BY_ID', 'Organization fetch completed', { 
        id, 
        found: !!organization 
      });

      return organization;
    } catch (error) {
      this.storageLog('GET_ORG_BY_ID', 'Failed to fetch organization by ID', { 
        id, 
        error: error.message 
      });
      throw new Error(`Failed to fetch organization: ${error.message}`);
    }
  }

  async updateOrganization(id: string, orgData: Partial<InsertOrganization>): Promise<Organization> {
    try {
      // Input validation
      if (!id || typeof id !== 'string') {
        throw new Error('Valid organization ID is required');
      }

      if (!orgData || Object.keys(orgData).length === 0) {
        throw new Error('Update data is required');
      }

      // Check if organization exists
      const existingOrg = await this.getOrganizationById(id);
      if (!existingOrg) {
        throw new Error('Organization not found');
      }

      this.storageLog('UPDATE_ORG', 'Updating organization', { id, updateFields: Object.keys(orgData) });

      const fields = [];
      const request = this.pool!.request();
      let paramIndex = 0;

      // Validate and sanitize update fields
      for (const [key, value] of Object.entries(orgData)) {
        if (value !== undefined && value !== null) {
          if (key === 'name') {
            if (typeof value !== 'string' || value.trim().length === 0) {
              throw new Error('Organization name must be a non-empty string');
            }

            // Check for duplicate names (excluding current organization)
            const duplicateCheck = await this.execute(`
              SELECT id FROM organizations 
              WHERE name = @param0 AND id != @param1 AND user_id = @param2
            `, [value.trim(), id, existingOrg.user_id]);

            if (duplicateCheck.length > 0) {
              throw new Error(`Organization with name "${value}" already exists`);
            }
          }

          const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
          const paramName = `param${paramIndex}`;
          fields.push(`${dbField} = @${paramName}`);

          // Sanitize string values
          const sanitizedValue = typeof value === 'string' ? value.trim() : value;
          request.input(paramName, this.getSqlType(key), sanitizedValue);
          paramIndex++;
        }
      }

      if (fields.length === 0) {
        this.storageLog('UPDATE_ORG', 'No valid fields to update', { id });
        return existingOrg;
      }

      // Add updated_at timestamp
      fields.push('updated_at = GETDATE()');
      request.input('id', sql.NVarChar(255), id);

      // Use transaction for consistency
      const transaction = this.pool!.transaction();
      await transaction.begin();

      try {
        const transactionRequest = transaction.request();

        // Copy all inputs to transaction request
        for (let i = 0; i < paramIndex; i++) {
          const paramName = `param${i}`;
          transactionRequest.input(paramName, request.parameters[paramName].type, request.parameters[paramName].value);
        }
        transactionRequest.input('id', sql.NVarChar(255), id);

        await transactionRequest.query(`
          UPDATE organizations 
          SET ${fields.join(', ')} 
          WHERE id = @id
        `);

        await transaction.commit();

        const updatedOrg = await this.getOrganizationById(id);

        this.storageLog('UPDATE_ORG', 'Organization updated successfully', { 
          id, 
          updatedFields: Object.keys(orgData) 
        });

        return updatedOrg as Organization;
      } catch (transactionError) {
        await transaction.rollback();
        throw transactionError;
      }
    } catch (error) {
      this.storageLog('UPDATE_ORG', 'Failed to update organization', { 
        id, 
        error: error.message 
      });
      throw new Error(`Failed to update organization: ${error.message}`);
    }
  }

  async deleteOrganization(id: string): Promise<void> {
    try {
      // Input validation
      if (!id || typeof id !== 'string') {
        throw new Error('Valid organization ID is required');
      }

      // Check if organization exists
      const existingOrg = await this.getOrganizationById(id);
      if (!existingOrg) {
        throw new Error('Organization not found');
      }

      this.storageLog('DELETE_ORG', 'Deleting organization', { id, name: existingOrg.name });

      // Check for dependent records
      const dependentChecks = await Promise.all([
        this.execute('SELECT COUNT(*) as count FROM departments WHERE organization_id = @param0', [id]),
        this.execute('SELECT COUNT(*) as count FROM projects WHERE organization_id = @param0', [id])
      ]);

      const [departmentCount, projectCount] = dependentChecks;

      if (departmentCount[0]?.count > 0) {
        throw new Error(`Cannot delete organization: ${departmentCount[0].count} department(s) still exist`);
      }

      if (projectCount[0]?.count > 0) {
        throw new Error(`Cannot delete organization: ${projectCount[0].count} project(s) still exist`);
      }

      // Use transaction for safe deletion
      const transaction = this.pool!.transaction();
      await transaction.begin();

      try {
        const transactionRequest = transaction.request();
        transactionRequest.input('id', sql.NVarChar(255), id);

        const result = await transactionRequest.query('DELETE FROM organizations WHERE id = @id');

        if (result.rowsAffected[0] === 0) {
          throw new Error('Organization not found or already deleted');
        }

        await transaction.commit();

        this.storageLog('DELETE_ORG', 'Organization deleted successfully', { 
          id, 
          name: existingOrg.name 
        });
      } catch (transactionError) {
        await transaction.rollback();
        throw transactionError;
      }
    } catch (error) {
      this.storageLog('DELETE_ORG', 'Failed to delete organization', { 
        id, 
        error: error.message 
      });
      throw new Error(`Failed to delete organization: ${error.message}`);
    }
  }

  // Helper method to get appropriate SQL type for different fields
  private getSqlType(fieldName: string): any {
    switch (fieldName) {
      case 'name':
        return sql.NVarChar(255);
      case 'description':
        return sql.NVarChar(sql.MAX);
      case 'user_id':
        return sql.NVarChar(255);
      default:
        return sql.NVarChar(sql.MAX);
    }
  }

  // Dashboard Stats
  async getDashboardStats(userId: string, startDate?: string, endDate?: string): Promise<any> {
    let dateFilter = '';
    const params = [userId];

    if (startDate && endDate) {
      dateFilter = 'AND date >= @param1 AND date <= @param2';
      params.push(startDate, endDate);
    } else {
      dateFilter = 'AND date >= DATEADD(month, -1, GETDATE())';
    }

    const [hoursResult, projectsResult, employeesResult] = await Promise.all([
      this.execute(`
        SELECT COALESCE(SUM(hours), 0) as total_hours 
        FROM time_entries 
        WHERE user_id = @param0 ${dateFilter}
      `, params),
      this.execute('SELECT COUNT(*) as total_projects FROM projects WHERE user_id = @param0', [userId]),
      this.execute('SELECT COUNT(*) as total_employees FROM employees WHERE user_id = @param0', [userId])
    ]);

    return {
      totalHours: hoursResult[0]?.total_hours || 0,
      totalProjects: projectsResult[0]?.total_projects || 0,
      totalEmployees: employeesResult[0]?.total_employees || 0
    };
  }



  async getTasksByProjectId(projectId: string): Promise<Task[]> {
    try {
      const result = await this.pool.request()
        .input('projectId', sql.NVarChar, projectId)
        .query('SELECT * FROM tasks WHERE project_id = @projectId ORDER BY created_at DESC');

      return result.recordset.map(this.mapTaskFromDb);
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Failed to get tasks by project ID:', error);
      throw error;
    }
  }

  async getProjectEmployees(): Promise<ProjectEmployee[]> {
    const result = await this.execute('SELECT * FROM project_employees');
    return result;
  }

  async getProjectEmployeesByProjectId(projectId: string): Promise<ProjectEmployee[]> {
    const result = await this.execute('SELECT * FROM project_employees WHERE project_id = @param0', [projectId]);
    return result;
  }

  async createProjectEmployee(projEmpData: InsertProjectEmployee): Promise<ProjectEmployee> {
    const insertData = {
      id: `pe-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      project_id: projEmpData.project_id,
      employee_id: projEmpData.employee_id,
      user_id: projEmpData.user_id
    };

    await this.execute(`
      INSERT INTO project_employees (id, project_id, employee_id, user_id, created_at)
      VALUES (@param0, @param1, @param2, @param3, GETDATE())
    `, [insertData.id, insertData.project_id, insertData.employee_id, insertData.user_id]);

    const result = await this.execute('SELECT * FROM project_employees WHERE id = @param0', [insertData.id]);
    return result[0];
  }

  async deleteProjectEmployee(id: string): Promise<void> {
    try {
      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), id);
      await request.query('DELETE FROM project_employees WHERE id = @id');
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error deleting project employee:', error);
      throw error;
    }
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

  // Add mapping helper functions for clarity and consistency
  private mapTaskFromDb(row: any): Task {
    return {
      id: row.id,
      project_id: row.project_id,
      title: row.title,
      name: row.name,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assigned_to: row.assigned_to,
      created_by: row.created_by,
      due_date: row.due_date,
      estimated_hours: row.estimated_hours,
      created_at: row.created_at,
      updated_at: row.updated_at,
      project_name: row.project_name // Added for convenience
    };
  }

  private mapTimeEntryFromDb(row: any): TimeEntry {
    return {
      id: row.id,
      user_id: row.user_id,
      project_id: row.project_id,
      task_id: row.task_id,
      description: row.description,
      hours: row.hours,
      duration: row.duration,
      date: row.date,
      start_time: row.start_time,
      end_time: row.end_time,
      status: row.status,
      billable: row.billable,
      is_billable: row.is_billable,
      is_approved: row.is_approved,
      is_manual_entry: row.is_manual_entry,
      is_timer_entry: row.is_timer_entry,
      is_template: row.is_template,
      created_at: row.created_at,
      updated_at: row.updated_at,
      project_name: row.project_name, // Added for convenience
      task_name: row.task_name     // Added for convenience
    };
  }

  private mapProjectFromDb(row: any): Project {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      organization_id: row.organization_id,
      department_id: row.department_id,
      manager_id: row.manager_id,
      user_id: row.user_id,
      start_date: row.start_date,
      end_date: row.end_date,
      budget: row.budget,
      project_number: row.project_number,
      is_enterprise_wide: row.is_enterprise_wide,
      is_template: row.is_template,
      allow_time_tracking: row.allow_time_tracking,
      require_task_selection: row.require_task_selection,
      enable_budget_tracking: row.enable_budget_tracking,
      enable_billing: row.enable_billing,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      console.log('🔴 [FMB-STORAGE] Database connection closed');
    }
  }

  /**
   * Health check method to verify database connectivity
   */
  async pingDatabase(): Promise<boolean> {
    try {
      const request = this.pool.request();
      await request.query('SELECT 1 as ping');
      return true;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Database ping failed:', error?.message);
      return false;
    }
  }

  // Dashboard Analytics Methods
  async getRecentActivity(userId: string, limit: number = 10): Promise<any[]> {
    try {
      const request = this.pool.request();
      request.input('userId', sql.NVarChar(255), userId);
      request.input('limit', sql.Int, limit);

      const result = await request.query(`
        SELECT TOP (@limit) 'time_entry' as type, te.description, te.date as created_at, te.hours,
               p.name as project_name
        FROM time_entries te
        LEFT JOIN projects p ON te.project_id = p.id
        WHERE te.user_id = @userId
        ORDER BY te.date DESC, te.created_at DESC
      `);

      return result.recordset;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error getting recent activity:', error);
      throw error;
    }
  }

  async getProjectTimeBreakdown(userId: string): Promise<any[]> {
    try {
      const request = this.pool.request();
      request.input('userId', sql.NVarChar(255), userId);

      const result = await request.query(`
        SELECT 
          p.id,
          p.name,
          '#1976D2' as color,
          COALESCE(SUM(te.hours), 0) as total_hours,
          COUNT(te.id) as entry_count
        FROM projects p
        LEFT JOIN time_entries te ON p.id = te.project_id AND te.user_id = @userId
        WHERE p.user_id = @userId OR p.id IN (
          SELECT DISTINCT project_id FROM time_entries WHERE user_id = @userId
        )
        GROUP BY p.id, p.name
        ORDER BY total_hours DESC
      `);

      return result.recordset;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error getting project breakdown:', error);
      throw error;
    }
  }

  // Department Hours Summary for Dashboard
  async getDepartmentHoursSummary(userId: string, startDate?: string, endDate?: string): Promise<any[]> {
    try {
      const request = this.pool.request();
      request.input('userId', sql.NVarChar(255), userId);

      let dateFilter = '';
      if (startDate && endDate) {
        request.input('startDate', sql.Date, startDate);
        request.input('endDate', sql.Date, endDate);
        dateFilter = 'AND te.date >= @startDate AND te.date <= @endDate';
      }

      const result = await request.query(`
        SELECT 
          COALESCE(d.name, 'No Department') as department_name,
          COALESCE(SUM(te.hours), 0) as total_hours,
          COUNT(DISTINCT te.user_id) as employee_count,
          COUNT(te.id) as entry_count
        FROM time_entries te
        LEFT JOIN users u ON te.user_id = u.id
        LEFT JOIN departments d ON u.department = d.name
        WHERE te.user_id = @userId ${dateFilter}
        GROUP BY d.name
        ORDER BY total_hours DESC
      `);

      return result.recordset;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error getting department hours summary:', error);
      throw error;
    }
  }

  // User Role Management
  async updateUserRole(userId: string, newRole: string): Promise<any> {
    try {
      const request = this.pool.request();
      request.input('userId', sql.NVarChar(255), userId);
      request.input('role', sql.NVarChar(50), newRole);

      const result = await request.query(`
        UPDATE users 
        SET role = @role, updated_at = GETDATE()
        WHERE id = @userId
      `);

      if (result.rowsAffected[0] > 0) {
        return await this.getUser(userId);
      } else {
        throw new Error('User not found or role not updated');
      }
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error updating user role:', error);
      throw error;
    }
  }

  // Add more methods as needed for FMB functionality
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
