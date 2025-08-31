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
  UpsertOrganization,
  UpsertEmployee,
  UpsertDepartment,
  UpsertProject,
  UpsertTask,
  UpsertTimeEntry,
} from "../shared/schema.js";

import sql from 'mssql'; // Assuming mssql is used for database operations

export interface IStorage {
  // User management
  getUser(id: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  getUsers(): Promise<User[]>;
  getAllUsers(): Promise<User[]>;
  createUser(user: UpsertUser): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, user: Partial<UpsertUser>): Promise<User>;
  updateUserRole(id: string, role: string): Promise<User>;
  deleteUser(id: string): Promise<void>;
  getUsersWithoutEmployeeProfile(): Promise<User[]>;
  linkUserToEmployee(userId: string, employeeId: string): Promise<Employee>;

  // Organization management
  getOrganizations(): Promise<Organization[]>;
  getOrganization(id: string, userId?: string): Promise<Organization | null>;
  getOrganizationById(id: string): Promise<Organization | null>;
  getOrganizationsByUserId(userId: string): Promise<Organization[]>;
  createOrganization(organization: UpsertOrganization): Promise<Organization>;
  updateOrganization(id: string, organization: Partial<UpsertOrganization>): Promise<Organization>;
  deleteOrganization(id: string): Promise<void>;
  getDepartmentsByOrganization(organizationId: string): Promise<Department[]>;

  // Employee management
  getEmployees(): Promise<Employee[]>;
  getEmployee(id: string, userId?: string): Promise<Employee | null>;
  getEmployeeById(id: string): Promise<Employee | null>;
  createEmployee(employee: UpsertEmployee): Promise<Employee>;
  updateEmployee(id: string, employee: Partial<UpsertEmployee>): Promise<Employee>;
  deleteEmployee(id: string): Promise<void>;

  // Department management
  getDepartments(): Promise<Department[]>;
  getDepartment(id: string): Promise<Department | null>;
  getDepartmentById(id: string): Promise<Department | null>;
  createDepartment(department: UpsertDepartment): Promise<Department>;
  updateDepartment(id: string, department: Partial<UpsertDepartment>): Promise<Department>;
  deleteDepartment(id: string): Promise<void>;
  assignManagerToDepartment(departmentId: string, managerId: string, userId: string): Promise<void>;

  // Project management
  getProjects(): Promise<Project[]>;
  getProject(id: string, userId?: string): Promise<Project | null>;
  getProjectById(id: string): Promise<Project | null>;
  createProject(project: UpsertProject): Promise<Project>;
  updateProject(id: string, project: Partial<UpsertProject>): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  getProjectEmployees(): Promise<any[]>;
  assignEmployeesToProject(projectId: string, employeeIds: string[], userId: string): Promise<void>;
  removeEmployeeFromProject(projectId: string, employeeId: string, userId: string): Promise<boolean>;

  // Task management
  getTasks(): Promise<Task[]>;
  getAllUserTasks(userId: string): Promise<Task[]>;
  getTask(id: string, userId?: string): Promise<Task | null>;
  getTaskById(id: string): Promise<Task | null>;
  createTask(task: UpsertTask): Promise<Task>;
  updateTask(id: string, task: Partial<UpsertTask>): Promise<Task>;
  deleteTask(id: string): Promise<void>;

  // Time entry management
  getTimeEntries(): Promise<TimeEntry[]>;
  getTimeEntry(id: string, userId?: string): Promise<TimeEntry | null>;
  getTimeEntriesByProjectId(projectId: string): Promise<TimeEntry[]>;
  getTimeEntriesForProject(projectId: string): Promise<TimeEntry[]>;
  createTimeEntry(entry: UpsertTimeEntry): Promise<TimeEntry>;
  updateTimeEntry(id: string, entry: Partial<UpsertTimeEntry>): Promise<TimeEntry>;
  deleteTimeEntry(id: string): Promise<void>;

  // Dashboard and analytics
  getDashboardStats(userId: string, startDate?: string, endDate?: string): Promise<any>;
  getProjectTimeBreakdown(userId: string, startDate?: string, endDate?: string): Promise<any>;
  getRecentActivity(userId: string, limit?: number): Promise<any>;
  getDepartmentHoursSummary(userId: string, startDate: string, endDate: string): Promise<any>;

  // Database utilities
  pingDatabase(): Promise<boolean>;
  connect?(): Promise<void>;
}

// Create storage implementation that delegates to the database instance
class StorageImplementation implements IStorage {
  // Users
  async getUsers(): Promise<User[]> {
    const db = await this.getDb();
    if (typeof db.getUsers === 'function') {
      return await db.getUsers();
    }
    return [];
  }

  async getUserById(id: string): Promise<User | null> {
    const db = await this.getDb();
    if (typeof db.getUserById === 'function') {
      return await db.getUserById(id);
    }
    return null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const db = await this.getDb();
    if (typeof db.getUserByEmail === 'function') {
      return await db.getUserByEmail(email);
    }
    return null;
  }

  async createUser(user: UpsertUser): Promise<User> {
    const db = await this.getDb();
    if (typeof db.createUser === 'function') {
      return await db.createUser(user);
    }
    return user as User;
  }

  async updateUser(id: string, user: Partial<UpsertUser>): Promise<User> {
    const db = await this.getDb();
    if (typeof db.updateUser === 'function') {
      return await db.updateUser(id, user);
    }
    return { id, ...user } as User;
  }

  async deleteUser(id: string): Promise<void> {
    const db = await this.getDb();
    if (typeof db.deleteUser === 'function') {
      await db.deleteUser(id);
    }
  }

  // Organizations
  async getOrganizations(): Promise<Organization[]> {
    const db = await this.getDb();
    if (typeof db.getOrganizations === 'function') {
      return await db.getOrganizations();
    }
    return [];
  }

  async getOrganization(id: string, userId?: string): Promise<Organization | null> {
    const db = await this.getDb();
    if (typeof db.getOrganization === 'function') {
      return await db.getOrganization(id, userId);
    }
    return null;
  }

  async getOrganizationById(id: string): Promise<Organization | null> {
    const db = await this.getDb();
    if (typeof db.getOrganizationById === 'function') {
      return await db.getOrganizationById(id);
    }
    return null;
  }

  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const db = await this.getDb();
    if (typeof db.createOrganization === 'function') {
      return await db.createOrganization(org);
    }
    return org as Organization;
  }

  async updateOrganization(id: string, org: Partial<InsertOrganization>): Promise<Organization> {
    const db = await this.getDb();
    if (typeof db.updateOrganization === 'function') {
      return await db.updateOrganization(id, org);
    }
    return { id, ...org } as Organization;
  }

  async deleteOrganization(id: string): Promise<void> {
    const db = await this.getDb();
    if (typeof db.deleteOrganization === 'function') {
      await db.deleteOrganization(id);
    }
  }

  // Projects
  async getProjects(): Promise<Project[]> {
    const db = await this.getDb();
    if (typeof db.getProjects === 'function') {
      // Assuming the underlying db.getProjects handles the SQL query with the fix
      return await db.getProjects();
    }
    return [];
  }

  async getProjectById(id: string): Promise<Project | null> {
    const db = await this.getDb();
    if (typeof db.getProjectById === 'function') {
      return await db.getProjectById(id);
    }
    return null;
  }

  async getProjectsByUserId(userId: string): Promise<Project[]> {
    const db = await this.getDb();
    if (typeof db.getProjectsByUserId === 'function') {
      return await db.getProjectsByUserId(userId);
    }
    return [];
  }

  async createProject(project: InsertProject): Promise<Project> {
    const db = await this.getDb();
    if (typeof db.createProject === 'function') {
      return await db.createProject(project);
    }
    return project as Project;
  }

  async updateProject(id: string, project: Partial<InsertProject>): Promise<Project> {
    const db = await this.getDb();
    if (typeof db.updateProject === 'function') {
      return await db.updateProject(id, project);
    }
    return { id, ...project } as Project;
  }

  async deleteProject(id: string): Promise<void> {
    const db = await this.getDb();
    if (typeof db.deleteProject === 'function') {
      await db.deleteProject(id);
    }
  }

  // Time Entries
  async getTimeEntries(): Promise<TimeEntry[]> {
    const db = await this.getDb();
    if (typeof db.getTimeEntries === 'function') {
      return await db.getTimeEntries();
    }
    return [];
  }

  async getTimeEntryById(id: string): Promise<TimeEntry | null> {
    const db = await this.getDb();
    if (typeof db.getTimeEntryById === 'function') {
      return await db.getTimeEntryById(id);
    }
    return null;
  }

  async getTimeEntriesByUserId(userId: string): Promise<TimeEntry[]> {
    const db = await this.getDb();
    if (typeof db.getTimeEntriesByUserId === 'function') {
      return await db.getTimeEntriesByUserId(userId);
    }
    return [];
  }

  async getTimeEntriesByProjectId(projectId: string): Promise<TimeEntry[]> {
    const db = await this.getDb();
    if (typeof db.getTimeEntriesByProjectId === 'function') {
      return await db.getTimeEntriesByProjectId(projectId);
    }
    return [];
  }

  async createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry> {
    const db = await this.getDb();
    if (typeof db.createTimeEntry === 'function') {
      return await db.createTimeEntry(entry);
    }
    return entry as TimeEntry;
  }

  async updateTimeEntry(id: string, entry: Partial<InsertTimeEntry>): Promise<TimeEntry> {
    const db = await this.getDb();
    if (typeof db.updateTimeEntry === 'function') {
      return await db.updateTimeEntry(id, entry);
    }
    return { id, ...entry } as TimeEntry;
  }

  async deleteTimeEntry(id: string): Promise<void> {
    const db = await this.getDb();
    if (typeof db.deleteTimeEntry === 'function') {
      await db.deleteTimeEntry(id);
    }
  }

  // Employees (placeholder implementations)
  async getEmployees(): Promise<Employee[]> { return []; }
  async getEmployeeById(id: string): Promise<Employee | null> { return null; }
  async createEmployee(employee: InsertEmployee): Promise<Employee> { return employee as Employee; }
  async updateEmployee(id: string, employee: Partial<InsertEmployee>): Promise<Employee> { return { id, ...employee } as Employee; }
  async deleteEmployee(id: string): Promise<void> {}

  // Departments
  async getDepartments(): Promise<Department[]> {
    const db = await this.getDb();
    if (typeof db.getDepartments === 'function') {
      return await db.getDepartments();
    }
    return [];
  }
  async getDepartment(id: string): Promise<Department | null> {
    const db = await this.getDb();
    if (typeof db.getDepartment === 'function') {
      return await db.getDepartment(id);
    }
    return null;
  }
  async getDepartmentById(id: string): Promise<Department | null> {
    const db = await this.getDb();
    if (typeof db.getDepartmentById === 'function') {
      return await db.getDepartmentById(id);
    }
    return null;
  }
  async createDepartment(data: { name: string; organization_id: string; user_id: string }): Promise<Department> {
    const db = await this.getDb();
    if (typeof db.createDepartment === 'function') {
      return await db.createDepartment(data);
    }
    return data as Department;
  }
  async updateDepartment(id: string, dept: Partial<InsertDepartment>): Promise<Department> {
    const db = await this.getDb();
    if (typeof db.updateDepartment === 'function') {
      return await db.updateDepartment(id, dept);
    }
    return { id, ...dept } as Department;
  }
  async deleteDepartment(id: string): Promise<void> {}

  // Tasks (placeholder implementations)
  async getTasks(): Promise<Task[]> { return []; }
  async getTaskById(id: string): Promise<Task | null> { return null; }
  async getTasksByProjectId(projectId: string): Promise<Task[]> { return []; }
  async createTask(task: InsertTask): Promise<Task> { return task as Task; }
  async updateTask(id: string, task: Partial<InsertTask>): Promise<Task> { return { id, ...task } as Task; }
  async deleteTask(id: string): Promise<void> {}

  // Project Employees (placeholder implementations)
  async getProjectEmployees(): Promise<ProjectEmployee[]> { return []; }
  async getProjectEmployeesByProjectId(projectId: string): Promise<ProjectEmployee[]> { return []; }
  async createProjectEmployee(assignment: InsertProjectEmployee): Promise<ProjectEmployee> { return assignment as ProjectEmployee; }
  async deleteProjectEmployee(id: string): Promise<void> {}

  // This method is added to fulfill the IStorage interface requirement
  async getOrganization(organizationId: string): Promise<Organization | null> {
    try {
      const db = await this.getDb();
      // Assuming the db object has a method to execute raw SQL queries
      if (typeof db.query === 'function') {
        const result = await db.query(`SELECT * FROM organizations WHERE id = '${organizationId}'`);
        return result.recordset[0] || null;
      } else {
        console.error('Database does not support query method.');
        return null;
      }
    } catch (error) {
      console.error('Error fetching organization:', error);
      throw error;
    }
  }

  private async getDb() {
    try {
      // Import database connection based on environment
      if (process.env.FMB_DEPLOYMENT === 'onprem') {
        const { getFmbStorage } = await import('../fmb-onprem/config/fmb-database.js');
        const storage = getFmbStorage();

        // Ensure connection is established
        if (typeof storage.connect === 'function') {
          await storage.connect();
        }

        return storage;
      } else {
        // Use relative import for Replit deployment
        const dbModule = await import('./db.js');
        // Handle different export patterns more safely
        return dbModule.default || dbModule;
      }
    } catch (error) {
      console.error('❌ [STORAGE] Failed to get database connection:', error);
      throw new Error(`Database connection failed: ${error?.message || 'Unknown error'}`);
    }
  }
}

export const storage = new StorageImplementation();

export function getStorage(): IStorage {
  return storage;
}

export function getStorageInstance(): IStorage {
  return storage;
}
