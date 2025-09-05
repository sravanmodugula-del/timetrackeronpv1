import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import PageLayout from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, CheckCircle, Circle, Copy, CheckSquare } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Project, Task, InsertTask } from "@shared/schema";
import TaskModal from "@/components/tasks/task-modal";
import TaskCloneModal from "@/components/tasks/task-clone-modal";
import Header from "@/components/layout/header";

export default function Tasks() {
  console.log("🔄 Tasks component mounting/re-rendering");
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const { canCreateTasks, canEditTasks } = usePermissions();
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState<string>(() => {
    const initial = "";
    console.log("🎯 Initial selectedProject state:", initial);
    return initial;
  });
  const [editingTask, setEditingTask] = useState<Task | null>(() => {
    const initial = null;
    console.log("📝 Initial editingTask state:", initial);
    return initial;
  });
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(() => {
    const initial = false;
    console.log("🔓 Initial isTaskModalOpen state:", initial);
    return initial;
  });
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false); // State for the create task modal

  // Redirect to home if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  // Debug state changes
  useEffect(() => {
    console.log("🔄 Tasks component state changed:", {
      selectedProject,
      editingTask: editingTask ? { id: editingTask.id, name: editingTask.name } : null,
      isTaskModalOpen,
      isCloneModalOpen,
      isCreateModalOpen
    });
  }, [selectedProject, editingTask, isTaskModalOpen, isCloneModalOpen, isCreateModalOpen]);

  // Fetch projects
  const { data: projects, isLoading: projectsLoading, error: projectsError } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
    enabled: isAuthenticated,
    retry: 3,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    select: (data) => {
      console.log("📊 Projects query select function called with data:", data);
      const result = Array.isArray(data) ? data : [];
      console.log("📊 Projects query returning:", result);
      return result;
    },
  });

  // Log projects data for debugging and auto-select first project
  React.useEffect(() => {
    console.log("📊 Projects data updated:", {
      projects: projects?.length || 0,
      projectsLoading,
      projectsError: projectsError?.message,
      selectedProject
    });

    // Auto-select first project if none selected and projects are available
    if (projects && projects.length > 0 && !selectedProject && !projectsLoading) {
      console.log("🎯 Auto-selecting first project:", projects[0].id);
      setSelectedProject(projects[0].id);
    }
  }, [projects, projectsLoading, projectsError, selectedProject]);

  // Fetch tasks for selected project
  const { data: tasks, isLoading: tasksLoading, refetch } = useQuery<Task[]>({
    queryKey: selectedProject === "all" ? ["/api/tasks/all"] : ["/api/projects", selectedProject, "tasks"],
    queryFn: async () => {
      console.log("🔄 Fetching tasks for project:", selectedProject);
      if (selectedProject === "all") {
        const result = await apiRequest("/api/tasks/all", "GET");
        console.log("📋 Tasks/all API result:", result);
        return result;
      } else if (selectedProject) {
        const result = await apiRequest(`/api/projects/${selectedProject}/tasks`, "GET");
        console.log("📋 Project tasks API result:", result);
        return result;
      } else {
        return [];
      }
    },
    enabled: isAuthenticated && selectedProject !== "" && selectedProject !== null,
    retry: 3,
    staleTime: 1000,
    select: (data) => {
      console.log("📋 Tasks select function called with:", data);
      const result = Array.isArray(data) ? data : [];
      console.log("📋 Tasks select returning:", result);
      return result;
    },
  });

  // Delete task mutation
  const deleteTask = useMutation({
    mutationFn: async (taskId: string) => {
      await apiRequest(`/api/tasks/${taskId}`, "DELETE");
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Task deleted successfully",
      });
      refetch();
    },
    onError: (error) => {
      if (isUnauthorizedError(error as Error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to delete task",
        variant: "destructive",
      });
    },
  });

  // Toggle task status mutation
  const toggleTaskStatus = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      await apiRequest(`/api/tasks/${taskId}`, "PUT", { status });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Task status updated",
      });
      refetch();
    },
    onError: (error) => {
      if (isUnauthorizedError(error as Error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to update task status",
        variant: "destructive",
      });
    },
  });

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task?')) {
      return;
    }
    deleteTask.mutate(taskId);
  };

  const handleToggleStatus = (taskId: string, currentStatus: string) => {
    const newStatus = currentStatus === "completed" ? "active" : "completed";
    toggleTaskStatus.mutate({ taskId, status: newStatus });
  };

  const handleEditTask = (task: Task) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  const handleCreateTask = () => {
    console.log("🎯 CREATE TASK BUTTON CLICKED - Starting debug trace");
    console.log("📋 Current component state:", {
      selectedProject,
      canCreateTasks,
      projects: projects?.length || 0,
      projectsData: projects,
      isTaskModalOpen,
      editingTask
    });

    if (selectedProject === "all" || !selectedProject || selectedProject.trim() === "") {
      console.log("❌ Selected project is 'all' or empty, showing error toast");
      toast({
        title: "Select a Project",
        description: "Please select a specific project to create a task",
        variant: "destructive",
      });
      return;
    }

    if (!projects || projects.length === 0) {
      console.log("❌ No projects available, showing error toast");
      toast({
        title: "No Projects Available",
        description: "Please create a project first before adding tasks",
        variant: "destructive",
      });
      return;
    }

    const selectedProjectData = projects.find(p => p.id === selectedProject);
    if (!selectedProjectData) {
      console.log("❌ Selected project not found in projects array");
      console.log("🔍 Projects available:", projects.map(p => ({ id: p.id, name: p.name })));
      toast({
        title: "Invalid Project",
        description: "Selected project not found. Please refresh and try again.",
        variant: "destructive",
      });
      return;
    }

    console.log("✅ All validations passed, opening task modal");
    console.log("📂 Selected project data:", selectedProjectData);

    setEditingTask(null);
    console.log("🔄 Set editingTask to null");

    setIsCreateModalOpen(true); // Open the create task modal
    console.log("🔄 Set isCreateModalOpen to true");

    console.log("🎯 CREATE TASK BUTTON CLICKED - End of function");
  };

  const getStatusColor = (status: string) => {
    console.log("🎨 Getting status color for:", status);
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-700";
      case "active":
        return "bg-blue-100 text-blue-700";
      case "archived":
        return "bg-gray-100 text-gray-700";
      default:
        console.log("⚠️ Unknown status:", status);
        return "bg-gray-100 text-gray-700";
    }
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Header Section */}
        <div className="md:flex md:items-center md:justify-between mb-8">
          <div className="flex-1 min-w-0">
            <div className="flex items-center">
              <CheckSquare className="w-8 h-8 text-blue-600 mr-3" />
              <div>
                <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate">
                  Task Management
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Create and manage tasks for your projects
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex md:mt-0 md:ml-4">
            {canCreateTasks && (
              <Button
                onClick={() => setIsCreateModalOpen(true)}
                disabled={selectedProject === "all" || !selectedProject || selectedProject === ""}
                title={selectedProject === "all" || !selectedProject || selectedProject === "" ? "Please select a project first" : "Create a new task"}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Task
              </Button>
            )}
          </div>
        </div>

        {/* Project Filter and Create Button */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Filter by Project</label>
                <Select
                  value={selectedProject}
                  onValueChange={(value) => {
                    console.log("🎯 Project selection changed:", { from: selectedProject, to: value });
                    setSelectedProject(value);
                  }}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Projects</SelectItem>
                    {Array.isArray(projects) && projects.filter(project =>
                      project?.id &&
                      typeof project.id === 'string' &&
                      project.id.trim() !== '' &&
                      project.name &&
                      typeof project.name === 'string' &&
                      project.name.trim() !== ''
                    ).map(project => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 sm:self-end">
                {canCreateTasks && (
                  <Button
                    variant="outline"
                    onClick={() => setIsCloneModalOpen(true)}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Clone Task
                  </Button>
                )}
                {/* Removed the duplicate "Add Task" button from here, as it's now in the header */}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tasks Display */}
        {(() => {
          console.log("🔍 Task display render check:", {
            selectedProject,
            tasksLoading,
            tasksData: tasks,
            tasksLength: tasks?.length,
            isTasksArray: Array.isArray(tasks),
            projects: projects?.length || 0
          });

          if (!selectedProject || selectedProject === "") {
            return (
              <Card>
                <CardContent className="p-8 text-center">
                  <p className="text-muted-foreground">Select a project to view and manage its tasks.</p>
                  {projects && projects.length > 0 && (
                    <p className="text-sm text-muted-foreground mt-2">
                      You have {projects.length} project{projects.length !== 1 ? 's' : ''} available
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          }

          if (selectedProject === "all") {
            return (
              <Card>
                <CardContent className="p-8 text-center">
                  <p className="text-muted-foreground">Select a specific project to view and manage its tasks.</p>
                  {projects && projects.length > 0 && (
                    <p className="text-sm text-muted-foreground mt-2">
                      You have {projects.length} project{projects.length !== 1 ? 's' : ''} available
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          }

          if (tasksLoading) {
            return (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                  <p className="text-muted-foreground">Loading tasks...</p>
                </CardContent>
              </Card>
            );
          }

          if (!tasks || tasks.length === 0) {
            const selectedProjectData = projects?.find(p => p.id === selectedProject);
            return (
              <Card>
                <CardContent className="p-8 text-center">
                  <p className="text-muted-foreground mb-4">
                    No tasks found for project: {selectedProjectData?.name || selectedProject}
                  </p>
                  {canCreateTasks && selectedProject && selectedProject !== "all" && selectedProject !== "" && (
                    <Button onClick={handleCreateTask}>
                      <Plus className="w-4 h-4 mr-2" />
                      Create Your First Task
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          }

          return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {tasks.map((task) => (
                <Card key={task.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleToggleStatus(task.id, task.status)}
                          className="text-gray-400 hover:text-primary transition-colors"
                        >
                          {task.status === "completed" ? (
                            <CheckCircle className="w-5 h-5 text-green-600" />
                          ) : (
                            <Circle className="w-5 h-5" />
                          )}
                        </button>
                        <h3 className={`font-semibold ${task.status === "completed" ? "line-through text-gray-500" : "text-gray-900"}`}>
                          {task.name || "Untitled Task"}
                        </h3>
                      </div>
                      <Badge className={getStatusColor(task.status)}>
                        {task.status}
                      </Badge>
                    </div>

                    {task.description && (
                      <p className="text-gray-600 text-sm mb-4 line-clamp-3">
                        {task.description}
                      </p>
                    )}

                    <div className="flex items-center space-x-2">
                      {canEditTasks && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditTask(task)}
                          className="text-gray-500 hover:text-gray-700"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      {canEditTasks && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteTask(task.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          );
        })()}
      </main>

      {/* Task Modal for editing */}
      {(() => {
        console.log("🔍 Task modal render condition check:", {
          isTaskModalOpen,
          editingTask,
          shouldRenderModal: isTaskModalOpen && editingTask
        });

        return (isTaskModalOpen && editingTask) ? (
          <TaskModal
            task={editingTask}
            projectId={selectedProject}
            isOpen={isTaskModalOpen}
            onClose={() => {
              console.log("🔒 Closing task modal");
              setIsTaskModalOpen(false);
              setEditingTask(null);
            }}
            onSuccess={() => {
              console.log("✅ Task operation successful, refreshing data");
              queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProject, "tasks"] });
              queryClient.invalidateQueries({ queryKey: ["/api/tasks/all"] });
              refetch();
              setIsTaskModalOpen(false);
              setEditingTask(null);
            }}
          />
        ) : null;
      })()}

      {/* Task Modal for creating */}
      {(() => {
        console.log("🔍 Create Task modal render condition check:", {
          isCreateModalOpen,
          selectedProject,
          isSelectedProjectNotAllOrEmpty: selectedProject && selectedProject !== "all",
          shouldRenderModal: isCreateModalOpen && selectedProject && selectedProject !== "all" && selectedProject !== ""
        });

        return (isCreateModalOpen && selectedProject && selectedProject !== "all" && selectedProject !== "") ? (
          <TaskModal
            task={null} // No task for creation
            projectId={selectedProject}
            isOpen={isCreateModalOpen}
            onClose={() => {
              console.log("🔒 Closing create task modal");
              setIsCreateModalOpen(false);
            }}
            onSuccess={() => {
              console.log("✅ Task creation successful, refreshing data");
              queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProject, "tasks"] });
              queryClient.invalidateQueries({ queryKey: ["/api/tasks/all"] });
              refetch();
              setIsCreateModalOpen(false);
            }}
          />
        ) : null;
      })()}


      {/* Task Clone Modal */}
      <TaskCloneModal
        isOpen={isCloneModalOpen}
        onClose={() => setIsCloneModalOpen(false)}
        onSuccess={() => {
          refetch();
          queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
        }}
        targetProjectId={selectedProject === "all" ? undefined : selectedProject}
      />
    </div>
  );
}