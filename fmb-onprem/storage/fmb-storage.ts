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
  private userId: string | null = null; // Added to store the current user ID for context

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

  // Add logging helper method
  private logInfo(message: string, data?: any) {
    console.log(`🗄️ [FMB-STORAGE] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }

  private logError(message: string, error?: any) {
    console.error(`🔴 [FMB-STORAGE] ${message}`, error);
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
          // SSL configuration removed for compatibility
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

    const executeId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    try {
      // Minimal execution logging
      if (query.includes('INSERT') || query.includes('UPDATE') || query.includes('DELETE')) {
        console.log(`🔄 [SQL] ${query.split(' ')[0]} operation on ${query.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i)?.[1] || 'table'}`);
      }

      const request = this.pool.request();

      // Bind parameters efficiently - only once
      params.forEach((param, index) => {
        request.input(`param${index}`, param);
      });

      // Minimal execution logging
      if (params.length > 0) {
        console.log(`🗄️ [SQL] Executing with ${params.length} parameters`);
      }

      const result = await request.query(query);

      // Success logging only for important operations
      if (query.includes('INSERT') || query.includes('UPDATE') || query.includes('DELETE')) {
        console.log(`✅ [SQL] Operation completed: ${result.rowsAffected?.[0] || 0} rows affected`);
      }

      this.storageLog('EXECUTE', `Query completed successfully`, {
        executeId,
        recordCount: result.recordset?.length || 0
      });

      return result.recordset || result.recordsets;
    } catch (error: any) {
      console.error(`❌ [EXECUTE-${executeId}] Query execution failed:`, {
        error: error.message,
        code: error.code,
        number: error.number,
        severity: error.class,
        state: error.state,
        procedure: error.procName,
        lineNumber: error.lineNumber,
        query: query.substring(0, 200),
        paramCount: params.length,
        paramValues: params
      });

      this.storageLog('EXECUTE', `Query execution failed`, {
        executeId,
        error: error.message,
        code: error.code,
        query: query.substring(0, 100) + '...'
      });

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

  async createOrganization(orgData: Partial<Organization>): Promise<Organization> {
    // IMMEDIATE DETECTION - This should appear FIRST in storage logs
    console.log(`🟥 [IMMEDIATE-STORAGE-DETECTION] createOrganization method called at ${new Date().toISOString()}`);
    console.log(`🟥 [IMMEDIATE-STORAGE-DETECTION] Input data:`, orgData);
    console.log(`🟥 [IMMEDIATE-STORAGE-DETECTION] Data type:`, typeof orgData);
    console.log(`🟥 [IMMEDIATE-STORAGE-DETECTION] User ID value:`, orgData.user_id);
    console.log(`🟥 [IMMEDIATE-STORAGE-DETECTION] User ID type:`, typeof orgData.user_id);

    const requestId = `org-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const id = `org-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // CHECKPOINT 1: Input validation and logging
    console.log(`🎯 [CHECKPOINT-1-${requestId}] Initial data received:`, {
      originalData: orgData,
      dataType: typeof orgData,
      hasName: 'name' in orgData,
      hasUserId: 'user_id' in orgData,
      nameValue: orgData.name,
      userIdValue: orgData.user_id,
      nameType: typeof orgData.name,
      userIdType: typeof orgData.user_id,
      generatedId: id
    });

    try {
      // CHECKPOINT 2: Field validation
      console.log(`🎯 [CHECKPOINT-2-${requestId}] Validating required fields...`);

      if (!orgData.name || orgData.name.trim().length === 0) {
        console.log(`❌ [CHECKPOINT-2-${requestId}] FAILED: Name validation failed`);
        throw new Error('Organization name is required and cannot be empty');
      }
      console.log(`✅ [CHECKPOINT-2-${requestId}] Name validation passed: "${orgData.name}"`);

      if (!orgData.user_id || orgData.user_id.trim().length === 0) {
        console.log(`❌ [CHECKPOINT-2-${requestId}] FAILED: User ID validation failed`);
        throw new Error('User ID is required for organization creation');
      }
      console.log(`✅ [CHECKPOINT-2-${requestId}] User ID validation passed: "${orgData.user_id}"`);

      // CHECKPOINT 3: Data sanitization
      console.log(`🎯 [CHECKPOINT-3-${requestId}] Sanitizing data...`);
      const sanitizedName = orgData.name.trim();
      const sanitizedDescription = orgData.description?.trim() || null;
      const sanitizedUserId = orgData.user_id.trim();

      console.log(`✅ [CHECKPOINT-3-${requestId}] Data sanitized:`, {
        originalName: orgData.name,
        sanitizedName: sanitizedName,
        originalDescription: orgData.description,
        sanitizedDescription: sanitizedDescription,
        originalUserId: orgData.user_id,
        sanitizedUserId: sanitizedUserId,
        sanitizedUserIdLength: sanitizedUserId.length
      });

      // CHECKPOINT 4: Database connection verification
      console.log(`🎯 [CHECKPOINT-4-${requestId}] Verifying database connection...`);
      if (!this.pool) {
        console.log(`❌ [CHECKPOINT-4-${requestId}] FAILED: No database pool available`);
        throw new Error('Database not connected');
      }

      if (!this.pool.connected) {
        console.log(`❌ [CHECKPOINT-4-${requestId}] FAILED: Database pool not connected`);
        throw new Error('Database connection lost');
      }
      console.log(`✅ [CHECKPOINT-4-${requestId}] Database connection verified`);

      // CHECKPOINT 5: Test database with simple query first
      console.log(`🎯 [CHECKPOINT-5-${requestId}] Testing database with simple query...`);
      try {
        const testResult = await this.execute('SELECT 1 as test_value');
        console.log(`✅ [CHECKPOINT-5-${requestId}] Simple query test passed:`, testResult);
      } catch (testError) {
        console.log(`❌ [CHECKPOINT-5-${requestId}] FAILED: Simple query test failed:`, testError);
        throw new Error(`Database query test failed: ${testError.message}`);
      }

      // CHECKPOINT 6: Verify table structure
      console.log(`🎯 [CHECKPOINT-6-${requestId}] Verifying organizations table structure...`);
      try {
        const tableInfo = await this.execute(`
          SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = 'organizations'
          ORDER BY ORDINAL_POSITION
        `);
        console.log(`✅ [CHECKPOINT-6-${requestId}] Table structure verified:`, tableInfo);
      } catch (tableError) {
        console.log(`❌ [CHECKPOINT-6-${requestId}] FAILED: Table structure check failed:`, tableError);
        throw new Error(`Table structure verification failed: ${tableError.message}`);
      }

      // CHECKPOINT 7: Test user_id exists in users table
      console.log(`🎯 [CHECKPOINT-7-${requestId}] Verifying user_id exists in users table...`);
      try {
        const userCheck = await this.execute('SELECT id, email, role FROM users WHERE id = @param0', [sanitizedUserId]);
        if (userCheck.length === 0) {
          console.log(`❌ [CHECKPOINT-7-${requestId}] FAILED: User not found in database`);
          throw new Error(`User with ID "${sanitizedUserId}" not found in users table`);
        }
        console.log(`✅ [CHECKPOINT-7-${requestId}] User exists in database:`, userCheck[0]);
      } catch (userError) {
        console.log(`❌ [CHECKPOINT-7-${requestId}] FAILED: User verification failed:`, userError);
        throw new Error(`User verification failed: ${userError.message}`);
      }

      // CHECKPOINT 8: Check for duplicate organization names
      console.log(`🎯 [CHECKPOINT-8-${requestId}] Checking for duplicate organization names...`);
      try {
        const duplicateCheck = await this.execute(
          'SELECT id, name FROM organizations WHERE name = @param0 AND user_id = @param1',
          [sanitizedName, sanitizedUserId]
        );
        if (duplicateCheck.length > 0) {
          console.log(`❌ [CHECKPOINT-8-${requestId}] FAILED: Duplicate organization name found:`, duplicateCheck[0]);
          throw new Error(`Organization with name "${sanitizedName}" already exists for this user`);
        }
        console.log(`✅ [CHECKPOINT-8-${requestId}] No duplicate names found`);
      } catch (dupError) {
        console.log(`❌ [CHECKPOINT-8-${requestId}] FAILED: Duplicate check failed:`, dupError);
        throw dupError;
      }

      // CHECKPOINT 9: Manual parameter preparation (bypassing execute method temporarily)
      console.log(`🎯 [CHECKPOINT-9-${requestId}] Preparing manual SQL execution...`);

      const insertSql = `
        INSERT INTO organizations (id, name, description, user_id, created_at, updated_at)
        VALUES (@id, @name, @description, @user_id, GETDATE(), GETDATE())
      `;

      console.log(`🎯 [CHECKPOINT-9-${requestId}] SQL Query:`, insertSql);
      console.log(`🎯 [CHECKPOINT-9-${requestId}] Parameters to bind:`, {
        id: { value: id, type: typeof id, length: id.length },
        name: { value: sanitizedName, type: typeof sanitizedName, length: sanitizedName.length },
        description: { value: sanitizedDescription, type: typeof sanitizedDescription, isNull: sanitizedDescription === null },
        user_id: { value: sanitizedUserId, type: typeof sanitizedUserId, length: sanitizedUserId.length }
      });

      // CHECKPOINT 10: Manual SQL execution with direct parameter binding
      console.log(`🎯 [CHECKPOINT-10-${requestId}] Creating request and binding parameters manually...`);

      const request = this.pool.request();

      // Bind each parameter individually with detailed logging
      console.log(`🔗 [CHECKPOINT-10-${requestId}] Binding parameter 'id'...`);
      request.input('id', sql.NVarChar(255), id);
      console.log(`✅ [CHECKPOINT-10-${requestId}] Parameter 'id' bound successfully`);

      console.log(`🔗 [CHECKPOINT-10-${requestId}] Binding parameter 'name'...`);
      request.input('name', sql.NVarChar(255), sanitizedName);
      console.log(`✅ [CHECKPOINT-10-${requestId}] Parameter 'name' bound successfully`);

      console.log(`🔗 [CHECKPOINT-10-${requestId}] Binding parameter 'description'...`);
      request.input('description', sql.NVarChar(sql.MAX), sanitizedDescription);
      console.log(`✅ [CHECKPOINT-10-${requestId}] Parameter 'description' bound successfully`);

      console.log(`🔗 [CHECKPOINT-10-${requestId}] Binding parameter 'user_id'...`);
      request.input('user_id', sql.NVarChar(255), sanitizedUserId);
      console.log(`✅ [CHECKPOINT-10-${requestId}] Parameter 'user_id' bound successfully`);

      // CHECKPOINT 11: Verify bound parameters before execution
      console.log(`🎯 [CHECKPOINT-11-${requestId}] Verifying all bound parameters:`, {
        boundParameterNames: Object.keys(request.parameters || {}),
        boundParameterDetails: Object.entries(request.parameters || {}).map(([name, param]: [string, any]) => ({
          name,
          type: param?.type?.name || 'unknown',
          value: param?.value,
          valueType: typeof param?.value,
          isNull: param?.value === null,
          isUndefined: param?.value === undefined
        }))
      });

      // CHECKPOINT 12: Execute the query
      console.log(`🎯 [CHECKPOINT-12-${requestId}] Executing INSERT query...`);

      try {
        const insertResult = await request.query(insertSql);
        console.log(`✅ [CHECKPOINT-12-${requestId}] INSERT query executed successfully:`, {
          rowsAffected: insertResult.rowsAffected,
          recordCount: insertResult.recordset?.length || 0
        });
      } catch (insertError) {
        console.log(`❌ [CHECKPOINT-12-${requestId}] INSERT query FAILED:`, {
          message: insertError.message,
          code: insertError.code,
          number: insertError.number,
          severity: insertError.class,
          state: insertError.state,
          procedure: insertError.procName,
          lineNumber: insertError.lineNumber,
          boundParams: Object.keys(request.parameters || {}),
          paramValues: Object.entries(request.parameters || {}).map(([name, param]: [string, any]) => ({
            name,
            value: param?.value,
            type: param?.type?.name
          }))
        });
        throw insertError;
      }

      // CHECKPOINT 13: Verify insertion by fetching the record
      console.log(`🎯 [CHECKPOINT-13-${requestId}] Verifying insertion by fetching created record...`);

      try {
        const fetchResult = await this.execute('SELECT * FROM organizations WHERE id = @param0', [id]);

        if (!fetchResult || fetchResult.length === 0) {
          console.log(`❌ [CHECKPOINT-13-${requestId}] FAILED: Record not found after insertion`);
          throw new Error('Organization was inserted but cannot be retrieved');
        }

        const createdOrg = fetchResult[0];
        console.log(`✅ [CHECKPOINT-13-${requestId}] Record successfully retrieved:`, {
          id: createdOrg.id,
          name: createdOrg.name,
          description: createdOrg.description,
          user_id: createdOrg.user_id,
          created_at: createdOrg.created_at
        });

        this.storageLog('CREATE_ORG', 'Organization created successfully', {
          id: createdOrg.id,
          name: createdOrg.name,
          user_id: createdOrg.user_id
        });

        return createdOrg;

      } catch (fetchError) {
        console.log(`❌ [CHECKPOINT-13-${requestId}] FAILED: Error fetching created record:`, fetchError);
        throw new Error(`Record fetch failed: ${fetchError.message}`);
      }

    } catch (error: any) {
      console.log(`❌ [CREATE_ORG-${requestId}] FINAL ERROR - Organization creation failed at checkpoint:`, {
        message: error.message,
        code: error.code,
        number: error.number,
        sqlState: error.state,
        severity: error.class,
        originalStack: error.stack?.split('\n').slice(0, 5)
      });

      this.storageLog('CREATE_ORG_ERROR', 'Failed to create organization', {
        error: error.message,
        code: error.code,
        checkpoint: 'See detailed logs above'
      });

      throw error;
    }
  }

  // Project Methods
  async getProjects(): Promise<Project[]> {
    try {
      const result = await this.pool.request()
        .input('user_id', this.userId)
        .query(`
          SELECT p.*, o.name as organization_name, d.name as department_name
          FROM projects p
          LEFT JOIN organizations o ON p.organization_id = o.id
          LEFT JOIN departments d ON p.department_id = d.id
          WHERE p.user_id = @user_id OR p.is_enterprise_wide = 1
          ORDER BY p.created_at DESC
        `);

      return result.recordset.map(this.mapProjectFromDb);
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error fetching projects:', error);
      throw error;
    }
  }

  async getProject(id: string, userId?: string): Promise<Project | null> {
    try {
      const result = await this.pool.request()
        .input('project_id', id)
        .input('user_id', userId || this.userId)
        .query(`
          SELECT p.*, o.name as organization_name, d.name as department_name
          FROM projects p
          LEFT JOIN organizations o ON p.organization_id = o.id
          LEFT JOIN departments d ON p.department_id = d.id
          WHERE p.id = @project_id
            AND (p.user_id = @user_id OR p.is_enterprise_wide = 1)
        `);

      if (result.recordset.length === 0) {
        return null;
      }

      return this.mapProjectFromDb(result.recordset[0]);
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error fetching project:', error);
      throw error;
    }
  }

  async getProjectById(id: string): Promise<Project | null> {
    return this.getProject(id);
  }

  async getProjectsByUserId(userId: string): Promise<ProjectWithEmployees[]> {
    const result = await this.execute(`
      SELECT p.*,
        (SELECT pe.*, e.first_name, e.last_name, e.employee_id as emp_employee_id
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
    const projectId = `proj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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

  async deleteProject(id: string, userId?: string): Promise<boolean> {
    try {
      console.log('🗑️ [FMB-STORAGE] Deleting project:', { id, userId });

      // First check if project exists and user has access
      const project = await this.getProject(id, userId);
      if (!project) {
        console.log('❌ [FMB-STORAGE] Project not found for deletion:', id);
        return false;
      }

      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), id);

      const result = await request.query('DELETE FROM projects WHERE id = @id');

      const deleted = result.rowsAffected[0] > 0;
      console.log('✅ [FMB-STORAGE] Project deleted:', { id, deleted });

      return deleted;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error deleting project:', error);
      throw error;
    }
  }

  // Task Methods
  async getTasks(): Promise<Task[]> {
    try {
      const result = await this.pool.request()
        .input('user_id', this.userId)
        .query(`
          SELECT t.*, p.name as project_name
          FROM tasks t
          INNER JOIN projects p ON t.project_id = p.id
          WHERE p.user_id = @user_id OR p.is_enterprise_wide = 1
          ORDER BY t.created_at DESC
        `);

      return result.recordset.map(this.mapTaskFromDb);
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error fetching tasks:', error);
      throw error;
    }
  }

  async getTask(id: string, userId?: string): Promise<Task | null> {
    try {
      const result = await this.pool.request()
        .input('task_id', id)
        .input('user_id', userId || this.userId)
        .query(`
          SELECT t.*, p.name as project_name
          FROM tasks t
          INNER JOIN projects p ON t.project_id = p.id
          WHERE t.id = @task_id
            AND (p.user_id = @user_id OR p.is_enterprise_wide = 1)
        `);

      if (result.recordset.length === 0) {
        return null;
      }

      return this.mapTaskFromDb(result.recordset[0]);
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error fetching task:', error);
      throw error;
    }
  }

  async getTaskById(id: string): Promise<Task | null> {
    return this.getTask(id);
  }

  // Get all tasks for a user across all their projects
  async getAllUserTasks(userId: string): Promise<TaskWithProject[]> {
    const executeId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    try {
      console.log("📋 [FMB-STORAGE] Fetching all tasks with project info for user:", userId);

      const request = this.pool.request();
      request.input('userId', this.sql.NVarChar, userId);

      const result = await this.executeWithRetry(
        request,
        `
        SELECT 
          t.id,
          t.project_id,
          t.name,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.assigned_to,
          t.created_by,
          t.due_date,
          t.estimated_hours,
          t.actual_hours,
          t.created_at,
          t.updated_at,
          p.name as project_name,
          p.color as project_color
        FROM tasks t
        INNER JOIN projects p ON t.project_id = p.id
        WHERE p.user_id = @userId
        ORDER BY t.created_at DESC
        `,
        executeId
      );

      const tasks = result.recordset.map((row: any) => ({
        id: row.id,
        project_id: row.project_id,
        name: row.name || row.title,
        title: row.title || row.name,
        description: row.description || '',
        status: row.status,
        priority: row.priority,
        assigned_to: row.assigned_to,
        created_by: row.created_by,
        due_date: row.due_date,
        estimated_hours: row.estimated_hours,
        actual_hours: row.actual_hours || 0,
        created_at: row.created_at,
        updated_at: row.updated_at,
        project: {
          id: row.project_id,
          name: row.project_name,
          color: row.project_color || '#1976D2'
        }
      }));

      console.log("📋 [FMB-STORAGE] Found all user tasks with project info:", tasks.length);
      console.log("📋 [FMB-STORAGE] All user task details:", tasks.map(t => ({
        id: t.id,
        name: t.name,
        project_id: t.project_id,
        status: t.status,
        project_name: t.project?.name
      })));

      return tasks;
    } catch (error: any) {
      console.error(`❌ [FMB-STORAGE] Error in getAllUserTasks:`, error);
      throw new Error(`Failed to fetch all user tasks: ${error.message}`);
    }
  }

  async createTask(taskData: InsertTask | any, userId?: string): Promise<Task> {
    try {
      const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      console.log('📝 [FMB-STORAGE] Creating task with data:', {
        taskId,
        taskData,
        userId,
        project_id: taskData.project_id || taskData.projectId
      });

      // Handle both project_id and projectId formats
      const projectId = taskData.project_id || taskData.projectId;
      if (!projectId) {
        throw new Error('project_id is required for task creation');
      }

      // Verify project exists first
      const projectExists = await this.execute('SELECT id FROM projects WHERE id = @param0', [projectId]);
      if (!projectExists || projectExists.length === 0) {
        throw new Error(`Project with ID ${projectId} does not exist`);
      }

      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), taskId);
      request.input('project_id', sql.NVarChar(255), projectId);
      request.input('title', sql.NVarChar(500), taskData.name || taskData.title);
      request.input('description', sql.NText, taskData.description || '');
      request.input('status', sql.NVarChar(50), taskData.status || 'active');
      request.input('priority', sql.NVarChar(50), taskData.priority || 'medium');
      request.input('assigned_to', sql.NVarChar(255), taskData.assigned_to || taskData.assignedTo || null);
      request.input('created_by', sql.NVarChar(255), userId || taskData.created_by || taskData.createdBy || null);
      request.input('due_date', sql.DateTime, taskData.due_date || taskData.dueDate ? new Date(taskData.due_date || taskData.dueDate) : null);
      request.input('estimated_hours', sql.Decimal(10, 2), taskData.estimated_hours || taskData.estimatedHours || null);
      request.input('actual_hours', sql.Decimal(10, 2), taskData.actual_hours || taskData.actualHours || 0);

      console.log('📝 [FMB-STORAGE] Task SQL parameters bound:', {
        id: taskId,
        project_id: projectId,
        title: taskData.name || taskData.title,
        status: taskData.status || 'active'
      });

      await request.query(`
        INSERT INTO tasks (
          id, project_id, title, description, status, priority,
          assigned_to, created_by, due_date, estimated_hours, actual_hours,
          created_at, updated_at
        ) VALUES (
          @id, @project_id, @title, @description, @status, @priority,
          @assigned_to, @created_by, @due_date, @estimated_hours, @actual_hours,
          GETDATE(), GETDATE()
        )
      `);

      const createdTask = await this.getTaskById(taskId);
      console.log(`✅ [FMB-STORAGE] Task created successfully: ${taskId} - "${taskData.name || taskData.title}"`);
      return createdTask as Task;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error creating task:', {
        error: error.message,
        taskData,
        userId
      });
      throw error;
    }
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

  async deleteTask(id: string, userId?: string): Promise<boolean> {
    try {
      console.log('🗑️ [FMB-STORAGE] Deleting task:', { id, userId });

      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), id);

      const result = await request.query('DELETE FROM tasks WHERE id = @id');

      const deleted = result.rowsAffected[0] > 0;
      console.log('✅ [FMB-STORAGE] Task deleted:', { id, deleted });

      return deleted;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error deleting task:', error);
      throw error;
    }
  }

  // Time Entry Methods
  async getTimeEntries(userId: string, filters?: {
    projectId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<TimeEntryWithProject[]> {
    try {
      console.log('🕒 [FMB-STORAGE] Fetching time entries for user:', userId, 'filters:', filters);

      const request = this.pool!.request();
      request.input('userId', sql.NVarChar(255), userId);

      let query = `
        SELECT 
          te.id,
          te.project_id,
          te.task_id,
          te.user_id,
          te.date,
          te.start_time,
          te.end_time,
          te.duration,
          te.hours,
          te.description,
          te.created_at,
          te.updated_at,
          p.name as project_name,
          p.project_number,
          p.status as project_status,
          t.title as task_name,
          t.description as task_description
        FROM time_entries te
        LEFT JOIN projects p ON te.project_id = p.id
        LEFT JOIN tasks t ON te.task_id = t.id
        WHERE te.user_id = @userId
      `;

      if (filters?.projectId && filters.projectId !== 'all') {
        query += ` AND te.project_id = @projectId`;
        request.input('projectId', sql.NVarChar(255), filters.projectId);
      }

      if (filters?.startDate) {
        query += ` AND te.date >= @startDate`;
        request.input('startDate', sql.Date, new Date(filters.startDate));
      }

      if (filters?.endDate) {
        query += ` AND te.date <= @endDate`;
        request.input('endDate', sql.Date, new Date(filters.endDate));
      }

      query += ` ORDER BY te.date DESC, te.created_at DESC`;

      if (filters?.limit) {
        query += ` OFFSET ${filters.offset || 0} ROWS FETCH NEXT ${filters.limit} ROWS ONLY`;
      }

      console.log('🔍 [FMB-STORAGE] Executing time entries query:', query.substring(0, 200) + '...');

      const result = await request.query(query);

      const timeEntries = result.recordset.map((row: any) => ({
        id: row.id,
        project_id: row.project_id,
        task_id: row.task_id,
        user_id: row.user_id,
        date: row.date,
        start_time: row.start_time,
        end_time: row.end_time,
        duration: row.duration || row.hours,
        hours: row.hours || row.duration,
        description: row.description,
        created_at: row.created_at,
        updated_at: row.updated_at,
        project: row.project_name ? {
          id: row.project_id,
          name: row.project_name,
          project_number: row.project_number,
          status: row.project_status
        } : undefined,
        task: row.task_name ? {
          id: row.task_id,
          name: row.task_name,
          description: row.task_description
        } : undefined
      }));

      console.log(`✅ [FMB-STORAGE] Found ${timeEntries.length} time entries for user ${userId}`);
      return timeEntries;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error fetching time entries:', {
        error: error.message,
        userId,
        filters
      });
      throw error;
    }
  }

  async getTimeEntry(id: string, userId?: string): Promise<TimeEntry | null> {
    try {
      const result = await this.pool.request()
        .input('entry_id', id)
        .input('user_id', userId || this.userId)
        .query(`
          SELECT te.*, p.name as project_name, p.project_number, t.name as task_name
          FROM time_entries te
          LEFT JOIN projects p ON te.project_id = p.id
          LEFT JOIN tasks t ON te.task_id = t.id
          WHERE te.id = @entry_id AND te.user_id = @user_id
        `);

      if (result.recordset.length === 0) {
        return null;
      }

      return this.mapTimeEntryFromDb(result.recordset[0]);
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error fetching time entry:', error);
      throw error;
    }
  }

  async getTimeEntryById(id: string): Promise<TimeEntry | null> {
    return this.getTimeEntry(id);
  }

  async getTimeEntriesByProjectId(projectId: string): Promise<TimeEntry[]> {
    const result = await this.execute('SELECT * FROM time_entries WHERE project_id = @param0', [projectId]);
    return result;
  }

  async createTimeEntry(timeEntryData: InsertTimeEntry): Promise<TimeEntry> {
      const insertData = {
        id: `te-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        user_id: timeEntryData.userId || timeEntryData.user_id,
        project_id: timeEntryData.projectId || timeEntryData.project_id,
        task_id: timeEntryData.taskId || timeEntryData.task_id,
        description: timeEntryData.description,
        hours: timeEntryData.hours,
        duration: timeEntryData.duration || timeEntryData.hours,
        date: timeEntryData.date,
        start_time: timeEntryData.startTime || timeEntryData.start_time,
        end_time: timeEntryData.endTime || timeEntryData.end_time,
        status: timeEntryData.status || 'draft',
        billable: timeEntryData.billable || false,
        is_billable: timeEntryData.isBillable || timeEntryData.is_billable || false,
        is_approved: timeEntryData.isApproved || timeEntryData.is_approved || false,
        is_manual_entry: timeEntryData.isManualEntry !== false && timeEntryData.is_manual_entry !== false,
        is_timer_entry: timeEntryData.isTimerEntry || timeEntryData.is_timer_entry || false,
        is_template: timeEntryData.isTemplate || timeEntryData.is_template || false
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

  async deleteTimeEntry(id: string, userId?: string): Promise<boolean> {
    try {
      console.log('🗑️ [FMB-STORAGE] Deleting time entry:', { id, userId });

      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), id);

      const result = await request.query('DELETE FROM time_entries WHERE id = @id');

      const deleted = result.rowsAffected[0] > 0;
      console.log('✅ [FMB-STORAGE] Time entry deleted:', { id, deleted });

      return deleted;
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

  async deleteDepartment(id: string, userId?: string): Promise<boolean> {
    try {
      console.log('🗑️ [FMB-STORAGE] Deleting department:', { id, userId });

      // First check if department exists
      const department = await this.getDepartmentById(id);
      if (!department) {
        console.log('❌ [FMB-STORAGE] Department not found for deletion:', id);
        return false;
      }

      const request = this.pool!.request();
      request.input('id', sql.NVarChar(255), id);

      const result = await request.query('DELETE FROM departments WHERE id = @id');

      const deleted = result.rowsAffected[0] > 0;
      console.log('✅ [FMB-STORAGE] Department deleted:', { id, deleted });

      return deleted;
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

  async deleteOrganization(id: string, userId?: string): Promise<boolean> {
    try {
      // Input validation
      if (!id || typeof id !== 'string') {
        throw new Error('Valid organization ID is required');
      }

      console.log('🗑️ [FMB-STORAGE] Deleting organization:', { id, userId });

      // Check if organization exists
      const existingOrg = await this.getOrganizationById(id);
      if (!existingOrg) {
        console.log('❌ [FMB-STORAGE] Organization not found for deletion:', id);
        return false;
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
          await transaction.rollback();
          console.log('❌ [FMB-STORAGE] Organization not found or already deleted:', id);
          return false;
        }

        await transaction.commit();

        this.storageLog('DELETE_ORG', 'Organization deleted successfully', {
          id,
          name: existingOrg.name
        });

        return true;
      } catch (transactionError) {
        await transaction.rollback();
        throw transactionError;
      }
    } catch (error) {
      this.storageLog('DELETE_ORG', 'Failed to delete organization', {
        id,
        error: error.message
      });
      console.error('🔴 [FMB-STORAGE] Delete organization error:', error);
      throw error;
    }
  }

  // Helper method to execute queries with proper parameter binding
  private async executeQuery(request: sql.Request, query: string): Promise<any> {
    if (!this.pool) {
      throw new Error('Database not connected. Call connect() first.');
    }

    return await request.query(query);
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
    try {
      const request = this.pool.request();
      request.input('userId', sql.NVarChar(255), userId);

      // Get today's date for filtering
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      
      // Get start of week (Monday)
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay() + 1);
      const weekStartStr = startOfWeek.toISOString().split('T')[0];
      
      // Get start of month
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthStartStr = startOfMonth.toISOString().split('T')[0];

      let dateFilter = '';
      if (startDate && endDate) {
        request.input('startDate', sql.Date, startDate);
        request.input('endDate', sql.Date, endDate);
        dateFilter = 'AND te.date >= @startDate AND te.date <= @endDate';
      }

      // Get various time period stats
      const [todayResult, weekResult, monthResult, projectsResult] = await Promise.all([
        request.query(`
          SELECT COALESCE(SUM(hours), 0) as total_hours
          FROM time_entries te
          WHERE te.user_id = @userId AND te.date = '${todayStr}'
        `),
        request.query(`
          SELECT COALESCE(SUM(hours), 0) as total_hours
          FROM time_entries te
          WHERE te.user_id = @userId AND te.date >= '${weekStartStr}'
        `),
        request.query(`
          SELECT COALESCE(SUM(hours), 0) as total_hours
          FROM time_entries te
          WHERE te.user_id = @userId AND te.date >= '${monthStartStr}'
        `),
        request.query(`
          SELECT COUNT(DISTINCT p.id) as count
          FROM projects p
          LEFT JOIN time_entries te ON p.id = te.project_id AND te.user_id = @userId
          WHERE p.user_id = @userId AND p.status = 'active'
        `)
      ]);

      const stats = {
        todayHours: parseFloat(todayResult.recordset[0]?.total_hours || 0),
        weekHours: parseFloat(weekResult.recordset[0]?.total_hours || 0),
        monthHours: parseFloat(monthResult.recordset[0]?.total_hours || 0),
        activeProjects: parseInt(projectsResult.recordset[0]?.count || 0)
      };

      console.log('📊 [FMB-STORAGE] Dashboard stats result:', stats);

      return stats;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error getting dashboard stats:', error);
      return {
        todayHours: 0,
        weekHours: 0,
        monthHours: 0,
        activeProjects: 0
      };
    }
  }



  // Get tasks by project ID
  async getTasksByProjectId(projectId: string): Promise<Task[]> {
    try {
      console.log(`🔍 [FMB-STORAGE] Fetching tasks for project: ${projectId}`);

      const request = this.pool.request();
      request.input('projectId', sql.NVarChar, projectId);

      const result = await this.executeQuery(request, `
        SELECT 
          id,
          project_id,
          title,
          description,
          status,
          priority,
          assigned_to,
          created_by,
          created_at,
          updated_at
        FROM tasks 
        WHERE project_id = @projectId
        ORDER BY created_at DESC
      `);

      console.log(`✅ [FMB-STORAGE] Found ${result.recordset.length} tasks for project ${projectId}`);

      return result.recordset.map(task => ({
        ...task,
        name: task.title || task.name || 'Untitled Task', // Ensure name is never null
        title: task.title || task.name || 'Untitled Task',
        status: task.status, // Use database status directly - no mapping needed
        projectId: task.project_id
      }));
    } catch (error) {
      console.error(`❌ [FMB-STORAGE] Error fetching tasks for project ${projectId}:`, error);
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
      color: row.color || '#1976D2', // Provide default color if null
      is_enterprise_wide: row.is_enterprise_wide || false,
      is_template: row.is_template || false,
      allow_time_tracking: row.allow_time_tracking !== false,
      require_task_selection: row.require_task_selection || false,
      enable_budget_tracking: row.enable_budget_tracking || false,
      enable_billing: row.enable_billing || false,
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

  /**
   * Comprehensive database schema verification for organizations table
   */
  async verifyOrganizationsTableSchema(): Promise<any> {
    try {
      console.log('🔍 [SCHEMA-VERIFY] Starting organizations table schema verification...');

      // Check if table exists
      const tableExists = await this.execute(`
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = 'organizations'
      `);

      if (tableExists.length === 0) {
        throw new Error('Organizations table does not exist');
      }
      console.log('✅ [SCHEMA-VERIFY] Organizations table exists');

      // Get column information
      const columns = await this.execute(`
        SELECT
          COLUMN_NAME,
          DATA_TYPE,
          IS_NULLABLE,
          CHARACTER_MAXIMUM_LENGTH,
          COLUMN_DEFAULT,
          ORDINAL_POSITION
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'organizations'
        ORDER BY ORDINAL_POSITION
      `);

      console.log('📋 [SCHEMA-VERIFY] Table columns:', columns);

      // Check constraints
      const constraints = await this.execute(`
        SELECT
          CONSTRAINT_NAME,
          CONSTRAINT_TYPE,
          COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        WHERE tc.TABLE_NAME = 'organizations'
      `);

      console.log('🔒 [SCHEMA-VERIFY] Table constraints:', constraints);

      // Check foreign key references
      const foreignKeys = await this.execute(`
        SELECT
          fk.name AS FK_NAME,
          tp.name AS PARENT_TABLE,
          cp.name AS PARENT_COLUMN,
          tr.name AS REFERENCED_TABLE,
          cr.name AS REFERENCED_COLUMN
        FROM sys.foreign_keys fk
        INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id
        INNER JOIN sys.tables tr ON fk.referenced_object_id = tr.object_id
        INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
        INNER JOIN sys.columns cp ON fkc.parent_column_id = cp.column_id AND fkc.parent_object_id = cp.object_id
        INNER JOIN sys.columns cr ON fkc.referenced_column_id = cr.column_id AND fkc.referenced_object_id = cr.object_id
        WHERE tp.name = 'organizations'
      `);

      console.log('🔗 [SCHEMA-VERIFY] Foreign key constraints:', foreignKeys);

      // Check specific user_id constraint
      const userIdConstraint = foreignKeys.find(fk => fk.PARENT_COLUMN === 'user_id');
      if (userIdConstraint) {
        console.log('🔍 [SCHEMA-VERIFY] Found user_id foreign key constraint:', userIdConstraint);

        // Test if the constraint is causing issues
        try {
          const testUserExists = await this.execute(`
            SELECT COUNT(*) as count FROM ${userIdConstraint.REFERENCED_TABLE}
            WHERE ${userIdConstraint.REFERENCED_COLUMN} = @param0
          `, ['admin-001']);

          console.log('🔍 [SCHEMA-VERIFY] Test user constraint validation:', {
            testUserId: 'admin-001',
            existsInReferencedTable: testUserExists[0]?.count > 0
          });
        } catch (constraintError) {
          console.log('❌ [SCHEMA-VERIFY] Constraint test failed:', constraintError);
        }
      } else {
        console.log('⚠️ [SCHEMA-VERIFY] No user_id foreign key constraint found');
      }

      return {
        tableExists: true,
        columns,
        constraints,
        foreignKeys,
        userIdConstraint
      };

    } catch (error) {
      console.error('❌ [SCHEMA-VERIFY] Schema verification failed:', error);
      throw error;
    }
  }

  // Dashboard Methods
  async getRecentActivity(userId: string, limit?: number, startDate?: string, endDate?: string): Promise<any[]> {
    try {
      const request = this.pool.request();
      request.input('userId', sql.NVarChar(255), userId);

      let limitClause = '';
      if (limit) {
        limitClause = `TOP ${limit}`;
      }

      let dateFilter = '';
      if (startDate && endDate) {
        request.input('startDate', sql.Date, startDate);
        request.input('endDate', sql.Date, endDate);
        dateFilter = 'AND te.date >= @startDate AND te.date <= @endDate';
      }

      const result = await request.query(`
        SELECT ${limitClause}
          te.id,
          'time_entry' as type,
          te.description,
          te.date as created_at,
          te.hours,
          te.duration,
          p.id as project_id,
          p.name as project_name
        FROM time_entries te
        INNER JOIN projects p ON te.project_id = p.id
        WHERE te.user_id = @userId ${dateFilter}
        ORDER BY te.created_at DESC, te.date DESC
      `);

      // Transform the results to match the expected frontend structure
      const activities = result.recordset.map(row => ({
        id: row.id,
        type: row.type,
        description: row.description || '',
        created_at: row.created_at,
        date: row.created_at,
        hours: row.hours,
        duration: row.duration || row.hours,
        project: {
          id: row.project_id,
          name: row.project_name
        }
      }));

      return activities;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error getting recent activity:', error);
      throw error;
    }
  }

  async getProjectTimeBreakdown(userId: string, startDate?: string, endDate?: string): Promise<any[]> {
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
          p.id,
          p.name,
          p.color,
          COALESCE(SUM(te.hours), 0) as total_hours,
          COUNT(te.id) as entry_count
        FROM projects p
        LEFT JOIN time_entries te ON p.id = te.project_id AND te.user_id = @userId ${dateFilter}
        WHERE p.user_id = @userId OR p.id IN (
          SELECT DISTINCT project_id FROM time_entries WHERE user_id = @userId ${dateFilter}
        )
        GROUP BY p.id, p.name, p.color
        HAVING COALESCE(SUM(te.hours), 0) > 0
        ORDER BY total_hours DESC
      `);

      // Transform to camelCase and calculate percentages
      const totalHours = result.recordset.reduce((sum, item) => sum + parseFloat(item.total_hours || 0), 0);

      const breakdown = result.recordset.map(row => ({
        project: {
          id: row.id,
          name: row.name,
          color: row.color || '#1976D2'
        },
        totalHours: parseFloat(row.total_hours || 0),
        total_hours: parseFloat(row.total_hours || 0), // Add snake_case for compatibility
        entryCount: parseInt(row.entry_count || 0),
        entry_count: parseInt(row.entry_count || 0), // Add snake_case for compatibility
        percentage: totalHours > 0 ? Math.round((parseFloat(row.total_hours || 0) / totalHours) * 100) : 0
      }));

      console.log('📊 [FMB-STORAGE] Project breakdown result:', {
        totalRecords: breakdown.length,
        totalHours,
        breakdown: breakdown.slice(0, 3) // Log first 3 for debugging
      });

      return breakdown;
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
  async updateUserRole(userId: string, newRole: string): Promise<User> {
    try {
      console.log('🗄️ [FMB-STORAGE] UPDATE_USER_ROLE:', { userId, role: newRole });

      // Use a single request with unique parameter names
      const request = this.pool!.request();
      request.input('targetUserId', sql.NVarChar(255), userId);
      request.input('newUserRole', sql.NVarChar(50), newRole);

      const updateResult = await request.query(`
        UPDATE users
        SET role = @newUserRole, updated_at = GETDATE()
        WHERE id = @targetUserId
      `);

      if (updateResult.rowsAffected[0] === 0) {
        throw new Error('User not found or role not updated');
      }

      // Fetch and return the updated user using the same request
      const fetchResult = await request.query(`
        SELECT * FROM users WHERE id = @targetUserId
      `);

      console.log('✅ [FMB-STORAGE] UPDATE_USER_ROLE: Role updated successfully');
      return fetchResult.recordset[0];
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error updating user role:', error);
      throw error;
    }
  }

  // Additional missing methods that need implementation
  async getAllUsers(): Promise<User[]> {
    console.log('🗄️ [FMB-STORAGE] GET_ALL_USERS: Fetching all users');

    const request = this.pool!.request();
    const result = await request.query(`
      SELECT id, email, first_name, last_name, role, profile_image_url, created_at, updated_at, is_active
      FROM users
      ORDER BY created_at DESC
    `);

    console.log(`✅ [FMB-STORAGE] GET_ALL_USERS: Found ${result.recordset.length} users`);
    return result.recordset;
  }

  async getUsersWithoutEmployeeProfile(): Promise<User[]> {
    console.log('🗄️ [FMB-STORAGE] GET_USERS_WITHOUT_EMPLOYEE: Fetching users without employee profiles');

    const request = this.pool!.request();
    const result = await request.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.profile_image_url, u.created_at, u.updated_at
      FROM users u
      LEFT JOIN employees e ON u.id = e.user_id
      WHERE e.user_id IS NULL
      ORDER BY u.created_at DESC
    `);

    console.log(`✅ [FMB-STORAGE] GET_USERS_WITHOUT_EMPLOYEE: Found ${result.recordset.length} users`);
    return result.recordset;
  }

  async linkUserToEmployee(userId: string, employeeId: string): Promise<Employee> {
    console.log('🗄️ [FMB-STORAGE] LINK_USER_TO_EMPLOYEE:', { userId, employeeId });

    const updateRequest = this.pool!.request();
    updateRequest.input('linkUserId', sql.NVarChar(255), userId);
    updateRequest.input('linkEmployeeId', sql.NVarChar(255), employeeId);

    // Update the employee record to link it to the user
    await updateRequest.query(`
      UPDATE employees
      SET user_id = @linkUserId, updated_at = GETDATE()
      WHERE id = @linkEmployeeId
    `);

    // Fetch and return the updated employee with a fresh request
    const fetchRequest = this.pool!.request();
    fetchRequest.input('fetchEmployeeId', sql.NVarChar(255), employeeId);

    const result = await fetchRequest.query(`
      SELECT * FROM employees WHERE id = @fetchEmployeeId
    `);

    console.log('✅ [FMB-STORAGE] LINK_USER_TO_EMPLOYEE: User linked successfully');
    return result.recordset[0];
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
