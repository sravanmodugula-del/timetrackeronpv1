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

    // Prepare parameters for the MERGE statement
    const request = this.pool!.request();
    request.input('id', sql.NVarChar(255), `user-${Date.now()}`); // Generate ID if new user
    request.input('email', sql.NVarChar(255), userData.email);
    request.input('firstName', sql.NVarChar(100), userData.first_name);
    request.input('lastName', sql.NVarChar(100), userData.last_name);
    request.input('profileImageUrl', sql.NVarChar(sql.MAX), userData.profile_image_url);
    request.input('role', sql.NVarChar(50), userData.role);
    request.input('organizationId', sql.NVarChar(255), userData.organization_id);
    request.input('department', sql.NVarChar(100), userData.department);
    request.input('isActive', sql.Bit, userData.is_active !== undefined ? userData.is_active : true); // Default to active

    // Add last_login_at parameter if provided
    if (userData.last_login_at !== undefined) {
      request.input('lastLoginAt', sql.DateTime2, userData.last_login_at);
    }

    // Insert or update user
    const upsertQuery = `
      MERGE users AS target
      USING (SELECT 
        @id as id, 
        @email as email, 
        @firstName as first_name, 
        @lastName as last_name, 
        @role as role, 
        @isActive as is_active
        ${userData.last_login_at !== undefined ? ', @lastLoginAt as last_login_at' : ', NULL as last_login_at'}
      ) AS source
      ON target.id = source.id OR target.email = source.email
      WHEN MATCHED THEN
        UPDATE SET 
          email = source.email,
          first_name = source.first_name,
          last_name = source.last_name,
          role = source.role,
          is_active = source.is_active,
          ${userData.last_login_at !== undefined ? 'last_login_at = source.last_login_at,' : ''}
          updated_at = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (id, email, first_name, last_name, role, is_active, last_login_at, created_at, updated_at)
        VALUES (source.id, source.email, source.first_name, source.last_name, source.role, source.is_active, source.last_login_at, GETDATE(), GETDATE());
    `;

    await request.query(upsertQuery);

    // Fetch the user after upserting
    return await this.getUserByEmail(userData.email) as User;
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
               (SELECT COUNT(*) FROM departments d WHERE d.organization_id = o.id) as department_count,
               (SELECT COUNT(*) FROM projects p WHERE p.organization_id = o.id) as project_count
        FROM organizations o
        WHERE o.user_id = @userId
        ORDER BY o.created_at DESC
      `);

      this.storageLog('GET_USER_ORGS', 'User organizations fetched successfully', {
        userId,
        count: result.length
      });

      return result;
    } catch (error) {
      this.storageLog('GET_USER_ORGS', 'Failed to fetch user organizations', {
        userId,
        error: error.message
      });
      throw new Error(`Failed to fetch organizations for user: ${error.message}`);
    }
  }

  async getAllOrganizations(): Promise<Organization[]> {
    try {
      const request = this.pool.request();

      const result = await request.query(`
        SELECT
          id,
          name,
          description,
          user_id,
          created_at as createdAt,
          updated_at as updatedAt,
          (SELECT COUNT(*) FROM departments WHERE organization_id = organizations.id) as department_count,
          (SELECT COUNT(*) FROM projects WHERE organization_id = organizations.id) as project_count
        FROM organizations
        ORDER BY created_at DESC
      `);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching all organizations:', error);
      throw error;
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
        .query(`
          SELECT p.*, o.name as organization_name, d.name as department_name
          FROM projects p
          LEFT JOIN organizations o ON p.organization_id = o.id
          LEFT JOIN departments d ON p.department_id = d.id
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
    request.input('color', sql.NVarChar(7), projectData.color || '#1976D2');
    request.input('isEnterpriseWide', sql.Bit, projectData.is_enterprise_wide || false);
    request.input('isTemplate', sql.Bit, projectData.is_template || false);
    request.input('allowTimeTracking', sql.Bit, projectData.allow_time_tracking !== false);
    request.input('requireTaskSelection', sql.Bit, projectData.require_task_selection || false);
    request.input('enableBudgetTracking', sql.Bit, projectData.enable_budget_tracking || false);
    request.input('enableBilling', sql.Bit, projectData.enable_billing || false);

    await request.query(`
      INSERT INTO projects (id, name, description, status, organization_id, department_id,
                           manager_id, user_id, start_date, end_date, budget, project_number,
                           color, is_enterprise_wide, is_template, allow_time_tracking,
                           require_task_selection, enable_budget_tracking, enable_billing,
                           created_at, updated_at)
      VALUES (@id, @name, @description, @status, @organizationId, @departmentId, @managerId, @userId,
              @startDate, @endDate, @budget, @projectNumber, @color, @isEnterpriseWide, @isTemplate,
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
          SELECT t.*, p.name as project_name, p.is_enterprise_wide
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
          SELECT t.*, p.name as project_name, p.is_enterprise_wide
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
      request.input('userId', sql.NVarChar, userId);

      const result = await request.query(`
        SELECT 
          t.id,
          t.project_id,
          t.title as name,
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
          p.color as project_color,
          p.is_enterprise_wide
        FROM tasks t
        INNER JOIN projects p ON t.project_id = p.id
        WHERE p.user_id = @userId OR p.is_enterprise_wide = 1
        ORDER BY t.created_at DESC
      `);

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

      console.log("📋 [FMB-STORAGE] Found all user tasks including enterprise-wide:", tasks.length);
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

      if (!this.pool) {
        throw new Error('Database pool not available');
      }

      const request = this.pool.request();
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
          '#1976D2' as project_color,
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
        console.log('🔍 [FMB-STORAGE] Filtering by project:', filters.projectId);
      }

      if (filters?.startDate) {
        query += ` AND CONVERT(date, te.date) >= CONVERT(date, @startDate)`;
        request.input('startDate', sql.Date, new Date(filters.startDate));
        console.log('🔍 [FMB-STORAGE] Filtering start date:', filters.startDate);
      }

      if (filters?.endDate) {
        query += ` AND CONVERT(date, te.date) <= CONVERT(date, @endDate)`;
        request.input('endDate', sql.Date, new Date(filters.endDate));
        console.log('🔍 [FMB-STORAGE] Filtering end date:', filters.endDate);
      }

      query += ` ORDER BY te.date DESC, te.created_at DESC`;

      if (filters?.limit && filters.limit > 0) {
        query += ` OFFSET ${filters.offset || 0} ROWS FETCH NEXT ${filters.limit} ROWS ONLY`;
      }

      console.log('🔍 [FMB-STORAGE] Executing time entries query with improved date handling');

      const result = await request.query(query);

      console.log('🔍 [FMB-STORAGE] Time entries raw result:', {
        recordCount: result.recordset?.length || 0,
        firstRecord: result.recordset?.[0] ? {
          id: result.recordset[0].id,
          date: result.recordset[0].date,
          hours: result.recordset[0].hours,
          project_name: result.recordset[0].project_name
        } : null
      });

      if (!result.recordset || result.recordset.length === 0) {
        console.log('🔍 [FMB-STORAGE] No time entries found for the given criteria');
        return [];
      }

      // Transform to the expected frontend format with consistent camelCase
      const timeEntries = result.recordset.map((row: any) => ({
        id: row.id,
        project_id: row.project_id,
        projectId: row.project_id, // Add camelCase alias
        task_id: row.task_id,
        taskId: row.task_id, // Add camelCase alias
        user_id: row.user_id,
        userId: row.user_id, // Add camelCase alias
        date: row.date,
        start_time: row.start_time ? row.start_time.substring(0, 5) : row.start_time,
        startTime: row.start_time ? row.start_time.substring(0, 5) : row.start_time, // Add camelCase alias
        end_time: row.end_time ? row.end_time.substring(0, 5) : row.end_time,
        endTime: row.end_time ? row.end_time.substring(0, 5) : row.end_time, // Add camelCase alias
        duration: parseFloat(row.duration || row.hours || 0),
        hours: parseFloat(row.hours || row.duration || 0),
        description: row.description || '',
        created_at: row.created_at,
        createdAt: row.created_at, // Add camelCase alias
        updated_at: row.updated_at,
        updatedAt: row.updated_at, // Add camelCase alias
        project: row.project_name ? {
          id: row.project_id,
          name: row.project_name,
          project_number: row.project_number,
          projectNumber: row.project_number, // Add camelCase alias
          status: row.project_status,
          color: row.project_color || '#1976D2'
        } : {
          id: row.project_id,
          name: 'Unknown Project',
          project_number: null,
          projectNumber: null,
          status: 'unknown',
          color: '#1976D2'
        },
        task: row.task_name ? {
          id: row.task_id,
          name: row.task_name,
          title: row.task_name,
          description: row.task_description
        } : null
      }));

      console.log(`✅ [FMB-STORAGE] Found ${timeEntries.length} time entries for user ${userId}`);
      console.log('✅ [FMB-STORAGE] Sample entries:', timeEntries.slice(0, 3).map(e => ({
        id: e.id,
        date: e.date,
        hours: e.hours,
        project: e.project?.name,
        description: e.description?.substring(0, 50)
      })));

      return timeEntries;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error fetching time entries:', {
        error: error.message,
        userId,
        filters
      });
      // Return empty array instead of throwing to prevent crashes
      return [];
    }
  }

  async getTimeEntry(id: string, userId?: string): Promise<TimeEntryWithProject | null> {
    try {
      console.log(`🔍 [FMB-STORAGE] Getting time entry: ${id} for user: ${userId || 'any'}`);

      const request = this.pool.request();
      request.input('id', sql.NVarChar(255), id);

      let userFilter = '';
      if (userId) {
        request.input('userId', sql.NVarChar(255), userId);
        userFilter = 'AND te.user_id = @userId';
      }

      const query = `
        SELECT 
          te.*,
          p.name as project_name,
          p.color as project_color,
          t.title as task_name,
          t.name as task_name_alt
        FROM time_entries te
        LEFT JOIN projects p ON te.project_id = p.id
        LEFT JOIN tasks t ON te.task_id = t.id
        WHERE te.id = @id ${userFilter}
      `;

      console.log(`🔍 [FMB-STORAGE] Executing getTimeEntry query with userFilter: '${userFilter}'`);
      const result = await request.query(query);

      console.log(`🔍 [FMB-STORAGE] GetTimeEntry result: ${result.recordset.length} records found`);

      if (result.recordset.length === 0) {
        console.log(`❌ [FMB-STORAGE] No time entry found for id: ${id} with userId: ${userId || 'any'}`);
        return null;
      }

      const entry = result.recordset[0];
      console.log(`✅ [FMB-STORAGE] Found time entry: ${entry.id} for user: ${entry.user_id}`);

      return {
        id: entry.id,
        user_id: entry.user_id,
        project_id: entry.project_id,
        task_id: entry.task_id,
        description: entry.description,
        date: entry.date,
        start_time: entry.start_time ? entry.start_time.substring(0, 5) : entry.start_time,
        end_time: entry.end_time ? entry.end_time.substring(0, 5) : entry.end_time,
        duration: parseFloat(entry.duration) || 0,
        hours: parseFloat(entry.hours) || parseFloat(entry.duration) || 0,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
        project_name: entry.project_name,
        project_color: entry.project_color,
        task_name: entry.task_name || entry.task_name_alt
      };
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error getting time entry:', error);
      return null;
    }
  }

  async getTimeEntryById(id: string): Promise<TimeEntry | null> {
    return this.getTimeEntry(id);
  }

  async getTimeEntriesByProjectId(projectId: string): Promise<TimeEntry[]> {
    const result = await this.execute('SELECT * FROM time_entries WHERE project_id = @param0', [projectId]);
    return result;
  }

  async getTimeEntriesForProject(projectId: string): Promise<TimeEntryWithProject[]> {
    try {
      console.log('📊 [FMB-STORAGE] Fetching time entries for project reports:', projectId);

      if (!this.pool) {
        throw new Error('Database pool not available');
      }

      const request = this.pool.request();
      request.input('projectId', sql.NVarChar(255), projectId);

      const result = await request.query(`
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
          '#1976D2' as project_color,
          t.title as task_name,
          t.description as task_description,
          u.first_name as user_first_name,
          u.last_name as user_last_name,
          u.email as user_email
        FROM time_entries te
        LEFT JOIN projects p ON te.project_id = p.id
        LEFT JOIN tasks t ON te.task_id = t.id
        LEFT JOIN users u ON te.user_id = u.id
        WHERE te.project_id = @projectId
        ORDER BY te.date DESC, te.created_at DESC
      `);

      console.log('📊 [FMB-STORAGE] Found time entries for project reports:', result.recordset?.length || 0);

      if (!result.recordset || result.recordset.length === 0) {
        return [];
      }

      // Transform to the expected format for reports
      const timeEntries = result.recordset.map((row: any) => ({
        id: row.id,
        project_id: row.project_id,
        projectId: row.project_id,
        task_id: row.task_id,
        taskId: row.task_id,
        user_id: row.user_id,
        userId: row.user_id,
        date: row.date,
        start_time: row.start_time,
        startTime: row.start_time,
        end_time: row.end_time,
        endTime: row.end_time,
        duration: parseFloat(row.duration || row.hours || 0),
        hours: parseFloat(row.hours || row.duration || 0),
        description: row.description || '',
        created_at: row.created_at,
        createdAt: row.created_at,
        updated_at: row.updated_at,
        updatedAt: row.updated_at,
        project: {
          id: row.project_id,
          name: row.project_name || 'Unknown Project',
          project_number: row.project_number,
          projectNumber: row.project_number,
          color: row.project_color || '#1976D2'
        },
        task: row.task_name ? {
          id: row.task_id,
          name: row.task_name,
          title: row.task_name,
          description: row.task_description
        } : null,
        employee: {
          id: row.user_id,
          first_name: row.user_first_name || 'Unknown',
          last_name: row.user_last_name || 'User',
          email: row.user_email
        }
      }));

      console.log('📊 [FMB-STORAGE] Transformed time entries for project reports:', timeEntries.length);

      return timeEntries;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error fetching time entries for project reports:', error);
      return [];
    }
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

  async updateTimeEntry(id: string, timeEntryData: Partial<InsertTimeEntry>, userId?: string): Promise<TimeEntry | null> {
    try {
      console.log(`🔧 [FMB-STORAGE] Updating time entry: ${id} for user: ${userId}`);
      console.log(`🔧 [FMB-STORAGE] Update data:`, timeEntryData);

      // Check if entry exists and belongs to user
      const existingEntry = await this.getTimeEntry(id, userId);
      if (!existingEntry) {
        console.log(`❌ [FMB-STORAGE] Time entry not found or access denied: ${id}`);
        return null;
      }

      const request = this.pool.request();
      request.input('id', sql.NVarChar(255), id);

      const fields: string[] = [];
      let paramIndex = 1;

      // Comprehensive field mappings for all time entry fields including both camelCase and snake_case
      const fieldMappings: { [key: string]: { dbField: string; sqlType: any } } = {
        userId: { dbField: 'user_id', sqlType: sql.NVarChar(255) },
        user_id: { dbField: 'user_id', sqlType: sql.NVarChar(255) },
        projectId: { dbField: 'project_id', sqlType: sql.NVarChar(255) },
        project_id: { dbField: 'project_id', sqlType: sql.NVarChar(255) },
        taskId: { dbField: 'task_id', sqlType: sql.NVarChar(255) },
        task_id: { dbField: 'task_id', sqlType: sql.NVarChar(255) },
        description: { dbField: 'description', sqlType: sql.NText },
        date: { dbField: 'date', sqlType: sql.Date },
        startTime: { dbField: 'start_time', sqlType: sql.VarChar(8) },
        start_time: { dbField: 'start_time', sqlType: sql.VarChar(8) },
        endTime: { dbField: 'end_time', sqlType: sql.VarChar(8) },
        end_time: { dbField: 'end_time', sqlType: sql.VarChar(8) },
        duration: { dbField: 'duration', sqlType: sql.Decimal(10, 2) },
        hours: { dbField: 'hours', sqlType: sql.Decimal(10, 2) },
        status: { dbField: 'status', sqlType: sql.NVarChar(50) },
        billable: { dbField: 'billable', sqlType: sql.Bit },
        isBillable: { dbField: 'is_billable', sqlType: sql.Bit },
        is_billable: { dbField: 'is_billable', sqlType: sql.Bit },
        isApproved: { dbField: 'is_approved', sqlType: sql.Bit },
        is_approved: { dbField: 'is_approved', sqlType: sql.Bit },
        isManualEntry: { dbField: 'is_manual_entry', sqlType: sql.Bit },
        is_manual_entry: { dbField: 'is_manual_entry', sqlType: sql.Bit },
        isTimerEntry: { dbField: 'is_timer_entry', sqlType: sql.Bit },
        is_timer_entry: { dbField: 'is_timer_entry', sqlType: sql.Bit },
        isTemplate: { dbField: 'is_template', sqlType: sql.Bit },
        is_template: { dbField: 'is_template', sqlType: sql.Bit }
      };

      for (const [key, value] of Object.entries(timeEntryData)) {
        if (value !== undefined && fieldMappings[key]) {
          const { dbField, sqlType } = fieldMappings[key];
          const paramName = `param${paramIndex}`;

          console.log(`🔧 [FMB-STORAGE] Processing field: ${key} = ${value} -> ${dbField}`);

          // Handle different data types appropriately
          if (key === 'date') {
            request.input(paramName, sqlType, new Date(value as string));
          } else if (key === 'duration' || key === 'hours') {
            request.input(paramName, sqlType, parseFloat(value as string));
          } else if (key.includes('billable') || key.includes('approved') || key.includes('manual') || key.includes('timer') || key.includes('template')) {
            // Handle boolean fields
            request.input(paramName, sqlType, Boolean(value));
          } else if (key === 'start_time' || key === 'startTime' || key === 'end_time' || key === 'endTime') {
            // Handle time fields as strings in HH:MM format - ensure we only store HH:MM
            const timeValue = value as string;
            const formattedTime = timeValue && timeValue.includes(':') 
              ? timeValue.substring(0, 5)  // Only take HH:MM part
              : timeValue;
            request.input(paramName, sqlType, formattedTime);
            console.log(`🔧 [FMB-STORAGE] Time field ${key} formatted: ${timeValue} -> ${formattedTime}`);
          } else {
            request.input(paramName, sqlType, value);
          }

          fields.push(`${dbField} = @${paramName}`);
          paramIndex++;
        } else if (value !== undefined) {
          console.log(`⚠️ [FMB-STORAGE] Field ${key} with value ${value} not found in fieldMappings`);
        }
      }

      if (fields.length > 0) {
        fields.push('updated_at = GETDATE()');

        const updateQuery = `
          UPDATE time_entries
          SET ${fields.join(', ')}
          WHERE id = @id
        `;

        console.log(`🔧 [FMB-STORAGE] Executing update query:`, updateQuery);
        console.log(`🔧 [FMB-STORAGE] Update fields:`, fields);
        console.log(`🔧 [FMB-STORAGE] Parameters:`, Object.entries(timeEntryData).map(([key, value]) => ({ key, value, mapped: fieldMappings[key]?.dbField })));

        const result = await request.query(updateQuery);

        if (result.rowsAffected[0] === 0) {
          console.log(`❌ [FMB-STORAGE] No rows updated for time entry: ${id}`);
          return null;
        }

        console.log(`✅ [FMB-STORAGE] Time entry updated successfully: ${id}, rows affected: ${result.rowsAffected[0]}`);
      }

      // Retrieve and return the updated entry
      const updatedEntry = await this.getTimeEntryById(id);
      console.log(`🔧 [FMB-STORAGE] Retrieved updated entry:`, updatedEntry ? 'Found' : 'Not found');

      return updatedEntry;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error updating time entry:', error);
      throw error;
    }
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

  async upsertEmployee(employeeData: {
    employee_id: string;
    first_name: string;
    last_name: string;
    department?: string;
    user_id: string;
  }): Promise<Employee> {
    try {
      // Check if employee exists by user_id first (primary lookup)
      const existingByUserId = await this.execute(
        'SELECT * FROM employees WHERE user_id = @param0',
        [employeeData.user_id]
      );

      // Check if employee exists by employee_id as secondary lookup
      const existingByEmployeeId = await this.execute(
        'SELECT * FROM employees WHERE employee_id = @param0',
        [employeeData.employee_id]
      );

      const existingEmployee = existingByUserId[0] || existingByEmployeeId[0];

      if (existingEmployee) {
        // Update existing employee record
        const request = this.pool!.request();
        request.input('id', sql.NVarChar(255), existingEmployee.id);
        request.input('employee_id', sql.NVarChar(255), employeeData.employee_id);
        request.input('first_name', sql.NVarChar(255), employeeData.first_name);
        request.input('last_name', sql.NVarChar(255), employeeData.last_name);
        request.input('department', sql.NVarChar(255), employeeData.department || null);
        request.input('user_id', sql.NVarChar(255), employeeData.user_id);

        await request.query(`
          UPDATE employees
          SET employee_id = @employee_id, first_name = @first_name, last_name = @last_name,
              department = @department, user_id = @user_id, updated_at = GETDATE()
          WHERE id = @id
        `);

        this.storageLog('UPSERT_EMPLOYEE', 'Employee record updated', {
          id: existingEmployee.id,
          employee_id: employeeData.employee_id,
          user_id: employeeData.user_id
        });

        return await this.getEmployeeById(existingEmployee.id) as Employee;
      } else {
        // Create new employee record
        const employeeId = `emp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const request = this.pool!.request();
        request.input('id', sql.NVarChar(255), employeeId);
        request.input('employee_id', sql.NVarChar(255), employeeData.employee_id);
        request.input('first_name', sql.NVarChar(255), employeeData.first_name);
        request.input('last_name', sql.NVarChar(255), employeeData.last_name);
        request.input('department', sql.NVarChar(255), employeeData.department || null);
        request.input('user_id', sql.NVarChar(255), employeeData.user_id);

        await request.query(`
          INSERT INTO employees (id, employee_id, first_name, last_name, department, user_id, created_at, updated_at)
          VALUES (@id, @employee_id, @first_name, @last_name, @department, @user_id, GETDATE(), GETDATE())
        `);

        this.storageLog('UPSERT_EMPLOYEE', 'Employee record created', {
          id: employeeId,
          employee_id: employeeData.employee_id,
          user_id: employeeData.user_id
        });

        return await this.getEmployeeById(employeeId) as Employee;
      }
    } catch (error) {
      this.storageLog('UPSERT_EMPLOYEE', 'Failed to upsert employee', {
        error: error.message,
        employee_id: employeeData.employee_id,
        user_id: employeeData.user_id
      });
      throw new Error(`Failed to upsert employee: ${error.message}`);
    }
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
    try {
      this.storageLog('GET_ALL_DEPARTMENTS', 'Fetching all departments for all users');

      const result = await this.execute(`
        SELECT d.*,
               e.first_name as manager_first_name,
               e.last_name as manager_last_name,
               o.name as organization_name
        FROM departments d
        LEFT JOIN employees e ON d.manager_id = e.id
        LEFT JOIN organizations o ON d.organization_id = o.id
        ORDER BY d.created_at DESC
      `);

      this.storageLog('GET_ALL_DEPARTMENTS', 'All departments fetched successfully', {
        count: result.length
      });

      return result;
    } catch (error) {
      this.storageLog('GET_ALL_DEPARTMENTS', 'Failed to fetch all departments', {
        error: error.message
      });
      throw new Error(`Failed to fetch departments: ${error.message}`);
    }
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

  async upsertDepartment(departmentData: {
    name: string;
    organization_id: string;
    description?: string;
    user_id: string;
    manager_id?: string;
  }): Promise<Department> {
    try {
      // Check if department exists by name and organization_id
      const existingDepartment = await this.execute(
        'SELECT * FROM departments WHERE name = @param0 AND organization_id = @param1',
        [departmentData.name, departmentData.organization_id]
      );

      if (existingDepartment && existingDepartment.length > 0) {
        // Update existing department record (only update description and manager if provided)
        const updateFields = [];
        const updateParams = [];
        let paramIndex = 0;

        if (departmentData.description !== undefined) {
          updateFields.push(`description = @param${paramIndex}`);
          updateParams.push(departmentData.description);
          paramIndex++;
        }

        if (departmentData.manager_id !== undefined) {
          updateFields.push(`manager_id = @param${paramIndex}`);
          updateParams.push(departmentData.manager_id);
          paramIndex++;
        }

        // Always update the updated_at timestamp
        updateFields.push('updated_at = GETDATE()');
        updateParams.push(existingDepartment[0].id);

        if (updateFields.length > 1) { // More than just updated_at
          await this.execute(`
            UPDATE departments
            SET ${updateFields.join(', ')}
            WHERE id = @param${paramIndex}
          `, updateParams);
        }

        this.storageLog('UPSERT_DEPARTMENT', 'Department record updated', {
          id: existingDepartment[0].id,
          name: departmentData.name,
          organization_id: departmentData.organization_id
        });

        return await this.getDepartmentById(existingDepartment[0].id) as Department;
      } else {
        // Create new department record
        const departmentId = `dept-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const request = this.pool!.request();
        request.input('id', sql.NVarChar(255), departmentId);
        request.input('name', sql.NVarChar(255), departmentData.name);
        request.input('organization_id', sql.NVarChar(255), departmentData.organization_id);
        request.input('description', sql.NVarChar(sql.MAX), departmentData.description || null);
        request.input('manager_id', sql.NVarChar(255), departmentData.manager_id || null);
        request.input('user_id', sql.NVarChar(255), departmentData.user_id);

        await request.query(`
          INSERT INTO departments (id, name, organization_id, manager_id, description, user_id, created_at, updated_at)
          VALUES (@id, @name, @organization_id, @manager_id, @description, @user_id, GETDATE(), GETDATE())
        `);

        this.storageLog('UPSERT_DEPARTMENT', 'Department record created', {
          id: departmentId,
          name: departmentData.name,
          organization_id: departmentData.organization_id
        });

        return await this.getDepartmentById(departmentId) as Department;
      }
    } catch (error) {
      this.storageLog('UPSERT_DEPARTMENT', 'Failed to upsert department', {
        error: error.message,
        name: departmentData.name,
        organization_id: departmentData.organization_id
      });
      throw new Error(`Failed to upsert department: ${error.message}`);
    }
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

  async getUserById(userId: string): Promise<User | null> {
    try {
      console.log('🗄️ [FMB-STORAGE] GET_USER_BY_ID:', { userId });

      const request = this.pool!.request();
      request.input('userId', sql.NVarChar(255), userId);

      const result = await request.query(`
        SELECT
          id,
          email,
          first_name as firstName,
          last_name as lastName,
          role,
          is_active as isActive,
          last_login_at as lastLoginAt,
          organization_id as organizationId,
          department,
          created_at as createdAt,
          updated_at as updatedAt
        FROM users
        WHERE id = @userId
      `);

      const user = result.recordset[0];
      console.log('👤 [FMB-STORAGE] User found:', user ? {
        id: user.id,
        role: user.role,
        email: user.email
      } : 'Not found');

      return user || null;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error getting user by ID:', error);
      throw error;
    }
  }

  async createUser(userData: UpsertUser): Promise<User> {
    return await this.upsertUser(userData);
  }

  async updateUser(userId: string, userData: Partial<any>): Promise<any> {
    try {
      console.log('👤 [FMB-STORAGE] Updating user:', userId, 'with data:', userData);

      if (!this.pool) {
        throw new Error('Database pool not available');
      }

      const request = this.pool.request();
      request.input('userId', sql.NVarChar(255), userId);

      const updateFields = [];
      const updateValues = [];

      // Handle different update fields
      if (userData.first_name !== undefined) {
        updateFields.push('first_name = @firstName');
        request.input('firstName', sql.NVarChar(100), userData.first_name);
      }
      if (userData.last_name !== undefined) {
        updateFields.push('last_name = @lastName');
        request.input('lastName', sql.NVarChar(100), userData.last_name);
      }
      if (userData.email !== undefined) {
        updateFields.push('email = @email');
        request.input('email', sql.NVarChar(255), userData.email);
      }
      if (userData.role !== undefined) {
        updateFields.push('role = @role');
        request.input('role', sql.NVarChar(50), userData.role);
      }
      if (userData.last_login_at !== undefined) {
        updateFields.push('last_login_at = @lastLoginAt');
        request.input('lastLoginAt', sql.DateTime2, userData.last_login_at);
      }
      if (userData.is_active !== undefined) {
        updateFields.push('is_active = @isActive');
        request.input('isActive', sql.Bit, userData.is_active);
      }

      if (updateFields.length === 0) {
        console.log('👤 [FMB-STORAGE] No fields to update');
        return await this.getUser(userId);
      }

      // Always update the updated_at field
      updateFields.push('updated_at = GETDATE()');

      const updateQuery = `
        UPDATE users 
        SET ${updateFields.join(', ')}
        WHERE id = @userId
      `;

      console.log('👤 [FMB-STORAGE] Update query:', updateQuery);

      await request.query(updateQuery);

      // Return the updated user
      const updatedUser = await this.getUser(userId);
      console.log('✅ [FMB-STORAGE] User updated successfully:', updatedUser?.email);

      return updatedUser;
    } catch (error) {
      console.error('❌ [FMB-STORAGE] Error updating user:', error);
      throw error;
    }
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
      console.log('📊 [FMB-STORAGE] Getting dashboard stats for user:', userId, 'dateRange:', { startDate, endDate });

      if (!this.pool) {
        throw new Error('Database pool not available');
      }

      // ALWAYS calculate today's hours regardless of the date range filter
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      // Get start of week (Monday)
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDay() === 0 ? now.getDate() - 6 : now.getDate() - (now.getDay() - 1)); // Adjust for Sunday being day 0
      const weekStartStr = startOfWeek.toISOString().split('T')[0];


      // Get start of month
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthStartStr = startOfMonth.toISOString().split('T')[0];

      console.log('📊 [FMB-STORAGE] Date ranges:', {
        today: todayStr,
        weekStart: weekStartStr,
        monthStart: monthStartStr,
        filterRange: { startDate, endDate }
      });

      // Create separate requests for each query to avoid parameter conflicts
      const todayRequest = this.pool.request();
      todayRequest.input('userId', sql.NVarChar(255), userId);
      todayRequest.input('todayDate', sql.NVarChar(10), todayStr);

      const weekRequest = this.pool.request();
      weekRequest.input('userId', sql.NVarChar(255), userId);
      weekRequest.input('weekStartDate', sql.NVarChar(10), weekStartStr);

      const monthRequest = this.pool.request();
      monthRequest.input('userId', sql.NVarChar(255), userId);
      monthRequest.input('monthStartDate', sql.NVarChar(10), monthStartStr);

      const projectsRequest = this.pool.request();
      projectsRequest.input('userId', sql.NVarChar(255), userId);

      // Execute queries with proper error handling
      try {
        const [todayResult, weekResult, monthResult, projectsResult] = await Promise.all([
          // TODAY's hours - use date field directly without conversion
          todayRequest.query(`
            SELECT COALESCE(SUM(CAST(hours as DECIMAL(10,2))), 0) as total_hours
            FROM time_entries te
            WHERE te.user_id = @userId
              AND te.date = @todayDate
          `),
          // WEEK's hours - last 7 days. The startOfWeek logic needs to be robust.
          // Let's adjust to calculate the start of the current week properly.
          // The existing `weekStartStr` logic is correct for start of week calculation.
          weekRequest.query(`
            SELECT COALESCE(SUM(CAST(hours as DECIMAL(10,2))), 0) as total_hours
            FROM time_entries te
            WHERE te.user_id = @userId
              AND te.date >= @weekStartDate
          `),
          // MONTH's hours - current month
          monthRequest.query(`
            SELECT COALESCE(SUM(CAST(hours as DECIMAL(10,2))), 0) as total_hours
            FROM time_entries te
            WHERE te.user_id = @userId
              AND te.date >= @monthStartDate
          `),
          // Active projects count
          projectsRequest.query(`
            SELECT COUNT(DISTINCT p.id) as count
            FROM projects p
            WHERE p.user_id = @userId AND p.status = 'active'
          `)
        ]);

        const stats = {
          todayHours: parseFloat(todayResult.recordset[0]?.total_hours || 0),
          weekHours: parseFloat(weekResult.recordset[0]?.total_hours || 0),
          monthHours: parseFloat(monthResult.recordset[0]?.total_hours || 0),
          activeProjects: parseInt(projectsResult.recordset[0]?.count || 0)
        };

        console.log('📊 [FMB-STORAGE] Dashboard stats calculated:', stats);
        console.log('📊 [FMB-STORAGE] Today check:', {
          todayStr,
          queryResult: todayResult.recordset[0],
          calculatedToday: stats.todayHours
        });

        return stats;
      } catch (queryError) {
        console.error('🔴 [FMB-STORAGE] Query execution error in dashboard stats:', queryError);
        throw queryError;
      }

    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error getting dashboard stats:', error);
      // Return safe defaults instead of throwing
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
      task_name: row.task_name // Added for convenience
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
      color: row.color || '#1976D2', // Use the color from the database or default
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
      console.log('📋 [FMB-STORAGE] Getting recent activity for user:', userId, 'limit:', limit, 'dateRange:', { startDate, endDate });

      if (!this.pool) {
        throw new Error('Database pool not available');
      }

      const request = this.pool.request();
      request.input('userId', sql.NVarChar(255), userId);

      let limitClause = '';
      if (limit && limit > 0) {
        limitClause = `TOP ${limit}`;
      }

      let dateFilter = '';
      if (startDate && endDate) {
        request.input('startDate', sql.Date, new Date(startDate + 'T00:00:00Z'));
        request.input('endDate', sql.Date, new Date(endDate + 'T23:59:59Z'));
        dateFilter = 'AND te.date >= @startDate AND te.date <= @endDate';
        console.log('📋 [FMB-STORAGE] Using date filter for recent activity:', { startDate, endDate });
      }

      const query = `
        SELECT ${limitClause}
          te.id,
          te.description,
          te.date,
          te.hours,
          te.duration,
          te.created_at,
          p.id as project_id,
          p.name as project_name,
          p.color as project_color
        FROM time_entries te
        INNER JOIN projects p ON te.project_id = p.id
        WHERE te.user_id = @userId ${dateFilter}
        ORDER BY te.date DESC, te.created_at DESC
      `;

      console.log('📋 [FMB-STORAGE] Executing recent activity query with date filter:', dateFilter);

      const result = await request.query(query);

      console.log('📋 [FMB-STORAGE] Recent activity raw result:', {
        recordCount: result.recordset?.length || 0,
        firstRecord: result.recordset?.[0],
        dateFilter,
        queryParams: { userId, startDate, endDate }
      });

      if (!result.recordset || result.recordset.length === 0) {
        console.log('📋 [FMB-STORAGE] No recent activity found - checking all time entries for user');

        // Debug query to see what time entries exist
        const debugRequest = this.pool.request();
        debugRequest.input('debugUserId', sql.NVarChar(255), userId);
        const debugResult = await debugRequest.query(`
          SELECT TOP 5 te.id, te.date, te.hours, te.description, p.name as project_name
          FROM time_entries te
          INNER JOIN projects p ON te.project_id = p.id
          WHERE te.user_id = @debugUserId
          ORDER BY te.date DESC, te.created_at DESC
        `);
        console.log('📋 [FMB-STORAGE] Debug - All recent time entries for user:', debugResult.recordset);

        return [];
      }

      // Transform the results to match the expected frontend structure
      const activities = result.recordset.map(row => ({
        id: row.id,
        type: 'time_entry',
        description: row.description || 'No description',
        date: row.date,
        created_at: row.created_at,
        hours: parseFloat(row.hours || 0),
        duration: parseFloat(row.duration || row.hours || 0),
        project: {
          id: row.project_id,
          name: row.project_name || 'Unknown Project',
          color: row.project_color || '#1976D2'
        },
        project_name: row.project_name // Add for compatibility
      }));

      console.log('📋 [FMB-STORAGE] Recent activity transformed:', {
        count: activities.length,
        activities: activities.map(a => ({
          id: a.id,
          type: a.type,
          description: a.description?.substring(0, 50),
          project: a.project.name,
          hours: a.hours,
          date: a.date
        }))
      });

      return activities;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error getting recent activity:', error);
      // Return empty array instead of throwing
      return [];
    }
  }

  async getProjectTimeBreakdown(userId: string, startDate?: string, endDate?: string): Promise<any[]> {
    try {
      console.log('📊 [FMB-STORAGE] Starting project breakdown query for user:', userId, 'dateRange:', { startDate, endDate });

      if (!this.pool) {
        throw new Error('Database pool not available');
      }

      // First, let's check what time entries exist for this user
      const checkRequest = this.pool.request();
      checkRequest.input('userId', sql.NVarChar(255), userId);

      const timeEntriesCheck = await checkRequest.query(`
        SELECT COUNT(*) as total_entries,
               COUNT(DISTINCT project_id) as unique_projects,
               MIN(date) as earliest_date,
               MAX(date) as latest_date,
               SUM(CAST(hours as DECIMAL(10,2))) as total_hours
        FROM time_entries
        WHERE user_id = @userId
      `);

      console.log('📊 [FMB-STORAGE] Time entries check:', timeEntriesCheck.recordset[0]);

      // If no time entries, return empty breakdown
      if (timeEntriesCheck.recordset[0]?.total_entries === 0) {
        console.log('📊 [FMB-STORAGE] No time entries found for user');
        return [];
      }

      // Create a new request for the main query
      const request = this.pool.request();
      request.input('userId', sql.NVarChar(255), userId);

      // Build the query to get project breakdown - use LEFT JOIN to include all projects
      let breakdownQuery = `
        SELECT
          p.id,
          p.name,
          p.color,
          COALESCE(SUM(CAST(te.hours as DECIMAL(10,2))), 0) as total_hours,
          COUNT(te.id) as entry_count
        FROM projects p
        LEFT JOIN time_entries te ON p.id = te.project_id AND te.user_id = @userId
      `;

      // Add date filter to the JOIN condition if provided
      if (startDate && endDate) {
        request.input('startDate', sql.Date, new Date(startDate));
        request.input('endDate', sql.Date, new Date(endDate));
        // Reconstruct query with INNER JOIN for filtered date range
        breakdownQuery = `
        SELECT
          p.id,
          p.name,
          p.color,
          COALESCE(SUM(CAST(te.hours as DECIMAL(10,2))), 0) as total_hours,
          COUNT(te.id) as entry_count
        FROM projects p
        INNER JOIN time_entries te ON p.id = te.project_id
        WHERE p.user_id = @userId
          AND te.user_id = @userId
          AND CONVERT(date, te.date) >= CONVERT(date, @startDate)
          AND CONVERT(date, te.date) <= CONVERT(date, @endDate)
        `;
        console.log('📊 [FMB-STORAGE] Using date filter from:', startDate, 'to:', endDate);
      } else {
        // If no date filter, ensure we are only counting entries for the specific user
        breakdownQuery += `
        INNER JOIN time_entries te ON p.id = te.project_id
        WHERE p.user_id = @userId AND te.user_id = @userId
        `;
      }

      breakdownQuery += `
        GROUP BY p.id, p.name, p.color
        ORDER BY SUM(CAST(te.hours as DECIMAL(10,2))) DESC
      `;

      console.log('📊 [FMB-STORAGE] Executing breakdown query:', breakdownQuery);

      const result = await request.query(breakdownQuery);

      console.log('📊 [FMB-STORAGE] Raw breakdown query result:', result.recordset);

      if (!result.recordset || result.recordset.length === 0) {
        console.log('📊 [FMB-STORAGE] No project breakdown data found');
        return [];
      }

      // Calculate total hours for percentage calculation
      const totalHours = result.recordset.reduce((sum, item) => sum + parseFloat(item.total_hours || 0), 0);

      console.log('📊 [FMB-STORAGE] Total hours across all projects:', totalHours);

      // Transform to the expected format
      const breakdown = result.recordset.map(row => {
        const hours = parseFloat(row.total_hours || 0);
        const entryCount = parseInt(row.entry_count || 0);
        const percentage = totalHours > 0 ? Math.round((hours / totalHours) * 100) : 0;

        return {
          project: {
            id: row.id,
            name: row.name,
            color: row.color || '#1976D2'
          },
          totalHours: hours,
          total_hours: hours, // Add snake_case for compatibility
          entryCount: entryCount,
          entry_count: entryCount, // Add snake_case for compatibility
          percentage: percentage
        };
      });

      console.log('📊 [FMB-STORAGE] Project breakdown result:', {
        totalRecords: breakdown.length,
        totalHours,
        breakdown: breakdown.map(b => ({
          project: b.project.name,
          hours: b.totalHours,
          entries: b.entryCount,
          percentage: b.percentage
        }))
      });

      return breakdown;
    } catch (error: any) {
      console.error('🔴 [FMB-STORAGE] Error getting project breakdown:', {
        message: error?.message,
        code: error?.code,
        number: error?.number,
        severity: error?.class,
        state: error?.state,
        procedure: error?.procName,
        lineNumber: error?.lineNumber
      });

      // Return empty array instead of throwing
      return [];
    }
  }

  // Department Hours Summary for Dashboard
  async getDepartmentHoursSummary(userId: string, startDate: string, endDate: string): Promise<any> {
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
          COALESCE(d.name, 'No Department') as departmentName,
          d.id as departmentId,
          CAST(COALESCE(SUM(te.hours), 0) AS FLOAT) as totalHours,
          COUNT(DISTINCT te.user_id) as employeeCount,
          COUNT(te.id) as entryCount
        FROM departments d
        LEFT JOIN users u ON u.department = d.name
        LEFT JOIN time_entries te ON te.user_id = u.id ${dateFilter.replace('WHERE te.user_id = @userId', '')}
        WHERE d.organization_id IN (
          SELECT organization_id FROM users WHERE id = @userId
        )
        GROUP BY d.id, d.name
        ORDER BY totalHours DESC
      `);

      console.log('🏢 [FMB-STORAGE] Department hours query result:', result.recordset);
      return result.recordset;
    } catch (error) {
      console.error('🔴 [FMB-STORAGE] Error getting department hours summary:', error);
      throw error;
    }
  }

  // Get user by ID
  // This method is consolidated into a single implementation above.
  // async getUserById(userId: string): Promise<User | null> {
  //   try {
  //     console.log('🗄️ [FMB-STORAGE] GET_USER_BY_ID:', { userId });

  //     const request = this.pool.request();
  //     request.input('userId', sql.NVarChar(255), userId);

  //     const result = await request.query(`
  //       SELECT
  //         id,
  //         email,
  //         first_name as firstName,
  //         last_name as lastName,
  //         role,
  //         is_active as isActive,
  //         last_login_at as lastLoginAt,
  //         organization_id as organizationId,
  //         department,
  //         created_at as createdAt,
  //         updated_at as updatedAt
  //       FROM users
  //       WHERE id = @userId
  //     `);

  //     const user = result.recordset[0];
  //     console.log('👤 [FMB-STORAGE] User found:', user ? { id: user.id, role: user.role } : 'Not found');

  //     return user || null;
  //   } catch (error) {
  //     console.error('🔴 [FMB-STORAGE] Error getting user by ID:', error);
  //     throw error;
  //   }
  // }

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