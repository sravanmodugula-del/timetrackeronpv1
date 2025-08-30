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
} from "../shared/schema.js";

export interface IStorage {
  // Users
  getUsers(): Promise<User[]>;
  getUserById(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  createUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, user: Partial<UpsertUser>): Promise<User>;
  deleteUser(id: string): Promise<void>;

  // Organizations
  getOrganizations(): Promise<Organization[]>;
  getOrganizationById(id: string): Promise<Organization | null>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(id: string, org: Partial<InsertOrganization>): Promise<Organization>;
  deleteOrganization(id: string): Promise<void>;

  // Employees
  getEmployees(): Promise<Employee[]>;
  getEmployeeById(id: string): Promise<Employee | null>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  updateEmployee(id: string, employee: Partial<InsertEmployee>): Promise<Employee>;
  deleteEmployee(id: string): Promise<void>;

  // Departments
  getDepartments(): Promise<Department[]>;
  getDepartmentById(id: string): Promise<Department | null>;
  createDepartment(dept: InsertDepartment): Promise<Department>;
  updateDepartment(id: string, dept: Partial<InsertDepartment>): Promise<Department>;
  deleteDepartment(id: string): Promise<void>;

  // Projects
  getProjects(): Promise<Project[]>;
  getProjectById(id: string): Promise<Project | null>;
  getProjectsByUserId(userId: string): Promise<Project[]>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, project: Partial<InsertProject>): Promise<Project>;
  deleteProject(id: string): Promise<void>;

  // Tasks
  getTasks(): Promise<Task[]>;
  getTaskById(id: string): Promise<Task | null>;
  getTasksByProjectId(projectId: string): Promise<Task[]>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: string, task: Partial<InsertTask>): Promise<Task>;
  deleteTask(id: string): Promise<void>;

  // Time Entries
  getTimeEntries(): Promise<TimeEntry[]>;
  getTimeEntryById(id: string): Promise<TimeEntry | null>;
  getTimeEntriesByUserId(userId: string): Promise<TimeEntry[]>;
  getTimeEntriesByProjectId(projectId: string): Promise<TimeEntry[]>;
  createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry>;
  updateTimeEntry(id: string, entry: Partial<InsertTimeEntry>): Promise<TimeEntry>;
  deleteTimeEntry(id: string): Promise<void>;

  // Project Employees
  getProjectEmployees(): Promise<ProjectEmployee[]>;
  getProjectEmployeesByProjectId(projectId: string): Promise<ProjectEmployee[]>;
  createProjectEmployee(assignment: InsertProjectEmployee): Promise<ProjectEmployee>;
  deleteProjectEmployee(id: string): Promise<void>;
}

// Create storage implementation that delegates to the database instance
class StorageImplementation implements IStorage {
  // Users
  async getUsers(): Promise<User[]> {
    if (typeof db.getUsers === 'function') {
      return await db.getUsers();
    }
    return [];
  }

  async getUserById(id: string): Promise<User | null> {
    if (typeof db.getUserById === 'function') {
      return await db.getUserById(id);
    }
    return null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    if (typeof db.getUserByEmail === 'function') {
      return await db.getUserByEmail(email);
    }
    return null;
  }

  async createUser(user: UpsertUser): Promise<User> {
    if (typeof db.createUser === 'function') {
      return await db.createUser(user);
    }
    return user as User;
  }

  async updateUser(id: string, user: Partial<UpsertUser>): Promise<User> {
    if (typeof db.updateUser === 'function') {
      return await db.updateUser(id, user);
    }
    return { id, ...user } as User;
  }

  async deleteUser(id: string): Promise<void> {
    if (typeof db.deleteUser === 'function') {
      await db.deleteUser(id);
    }
  }

  // Organizations
  async getOrganizations(): Promise<Organization[]> {
    if (typeof db.getOrganizations === 'function') {
      return await db.getOrganizations();
    }
    return [];
  }

  async getOrganizationById(id: string): Promise<Organization | null> {
    if (typeof db.getOrganizationById === 'function') {
      return await db.getOrganizationById(id);
    }
    return null;
  }

  async createOrganization(org: InsertOrganization): Promise<Organization> {
    if (typeof db.createOrganization === 'function') {
      return await db.createOrganization(org);
    }
    return org as Organization;
  }

  async updateOrganization(id: string, org: Partial<InsertOrganization>): Promise<Organization> {
    if (typeof db.updateOrganization === 'function') {
      return await db.updateOrganization(id, org);
    }
    return { id, ...org } as Organization;
  }

  async deleteOrganization(id: string): Promise<void> {
    if (typeof db.deleteOrganization === 'function') {
      await db.deleteOrganization(id);
    }
  }

  // Projects
  async getProjects(): Promise<Project[]> {
    if (typeof db.getProjects === 'function') {
      return await db.getProjects();
    }
    return [];
  }

  async getProjectById(id: string): Promise<Project | null> {
    if (typeof db.getProjectById === 'function') {
      return await db.getProjectById(id);
    }
    return null;
  }

  async getProjectsByUserId(userId: string): Promise<Project[]> {
    if (typeof db.getProjectsByUserId === 'function') {
      return await db.getProjectsByUserId(userId);
    }
    return [];
  }

  async createProject(project: InsertProject): Promise<Project> {
    if (typeof db.createProject === 'function') {
      return await db.createProject(project);
    }
    return project as Project;
  }

  async updateProject(id: string, project: Partial<InsertProject>): Promise<Project> {
    if (typeof db.updateProject === 'function') {
      return await db.updateProject(id, project);
    }
    return { id, ...project } as Project;
  }

  async deleteProject(id: string): Promise<void> {
    if (typeof db.deleteProject === 'function') {
      await db.deleteProject(id);
    }
  }

  // Time Entries
  async getTimeEntries(): Promise<TimeEntry[]> {
    if (typeof db.getTimeEntries === 'function') {
      return await db.getTimeEntries();
    }
    return [];
  }

  async getTimeEntryById(id: string): Promise<TimeEntry | null> {
    if (typeof db.getTimeEntryById === 'function') {
      return await db.getTimeEntryById(id);
    }
    return null;
  }

  async getTimeEntriesByUserId(userId: string): Promise<TimeEntry[]> {
    if (typeof db.getTimeEntriesByUserId === 'function') {
      return await db.getTimeEntriesByUserId(userId);
    }
    return [];
  }

  async getTimeEntriesByProjectId(projectId: string): Promise<TimeEntry[]> {
    if (typeof db.getTimeEntriesByProjectId === 'function') {
      return await db.getTimeEntriesByProjectId(projectId);
    }
    return [];
  }

  async createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry> {
    if (typeof db.createTimeEntry === 'function') {
      return await db.createTimeEntry(entry);
    }
    return entry as TimeEntry;
  }

  async updateTimeEntry(id: string, entry: Partial<InsertTimeEntry>): Promise<TimeEntry> {
    if (typeof db.updateTimeEntry === 'function') {
      return await db.updateTimeEntry(id, entry);
    }
    return { id, ...entry } as TimeEntry;
  }

  async deleteTimeEntry(id: string): Promise<void> {
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

  // Departments (placeholder implementations)
  async getDepartments(): Promise<Department[]> { return []; }
  async getDepartmentById(id: string): Promise<Department | null> { return null; }
  async createDepartment(dept: InsertDepartment): Promise<Department> { return dept as Department; }
  async updateDepartment(id: string, dept: Partial<InsertDepartment>): Promise<Department> { return { id, ...dept } as Department; }
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
}

export const storage = new StorageImplementation();