import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { insertTaskSchema } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Task } from "@shared/schema";

interface TaskModalProps {
  task?: Task | null;
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const taskFormSchema = insertTaskSchema.extend({
  name: z.string().min(1, "Task name is required"),
  status: z.enum(["active", "completed", "archived"]).default("active"),
  description: z.string().nullable().optional().transform(val => val || ""),
  project_id: z.string().min(1, "Project ID is required"),
});

type TaskFormData = z.infer<typeof taskFormSchema>;

export default function TaskModal({ task, projectId, isOpen, onClose, onSuccess }: TaskModalProps) {
  console.log("🎭 TaskModal component rendered with props:", {
    task: task ? { id: task.id, name: task.name } : null,
    projectId,
    isOpen,
    isEditing: !!task
  });
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!task;

  // Debug modal state changes
  useEffect(() => {
    console.log("🔄 TaskModal state change:", {
      isOpen,
      projectId,
      taskExists: !!task,
      isEditing
    });
    
    if (isOpen && !isEditing) {
      // Reset form when opening for new task creation
      console.log("🔄 Resetting form for new task creation");
      form.reset({
        project_id: projectId,
        name: "",
        description: "",
        status: "active",
      });
      
      // Clear any previous errors
      form.clearErrors();
    }
  }, [isOpen, projectId, task, isEditing]);

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      project_id: projectId,
      name: "",
      description: "",
      status: "active",
    },
    mode: "onChange",
  });

  // Initialize form values when modal opens or task changes
  useEffect(() => {
    if (isOpen) {
      if (isEditing && task) {
        form.reset({
          project_id: projectId,
          name: task.name || "",
          description: task.description || "",
          status: (task.status as "active" | "completed" | "archived") || "active",
        });
      } else {
        form.reset({
          project_id: projectId,
          name: "",
          description: "",
          status: "active",
        });
      }
    }
  }, [isOpen, isEditing, task, projectId, form]);

  

  // Create task mutation
  const createTask = useMutation({
    mutationFn: async (data: TaskFormData) => {
      console.log("📝 Task form data received:", data);

      // Validate required fields
      if (!data.name?.trim()) {
        throw new Error("Task name is required");
      }
      if (!data.project_id?.trim()) {
        throw new Error("Project ID is required");
      }

      const payload = {
        name: data.name.trim(),
        description: data.description?.trim() || "",
        status: data.status || "active",
        projectId: data.project_id.trim(),
      };

      console.log("🔧 Creating task with payload:", payload);
      console.log("🔧 API Request details:", {
        endpoint: `/api/projects/${payload.projectId}/tasks`,
        method: "POST",
        payload: payload
      });
      
      try {
        const response = await apiRequest(`/api/projects/${payload.projectId}/tasks`, "POST", payload);
        console.log("✅ Task creation response:", response);
        return response;
      } catch (error) {
        console.error("❌ API Request failed:", error);
        throw error;
      }
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Task created successfully",
      });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", { projectId }] });
      onSuccess();
    },
    onError: (error) => {
      console.error("❌ Task creation error:", error);

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

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: "Error",
        description: `Failed to create task: ${errorMessage}`,
        variant: "destructive",
      });
    },
  });

  // Update task mutation
  const updateTask = useMutation({
    mutationFn: async (data: TaskFormData) => {
      await apiRequest(`/api/tasks/${task!.id}`, "PUT", data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Task updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", { projectId }] });
      onSuccess();
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
        description: "Failed to update task",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: TaskFormData) => {
    console.log("🚀 Task form submitted:", { isEditing, data });

    // Ensure project_id is set correctly
    if (!data.project_id) {
      data.project_id = projectId;
    }

    if (isEditing) {
      updateTask.mutate(data);
    } else {
      createTask.mutate(data);
    }
  };

  

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Task" : "Create New Task"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the task details below."
              : "Fill in the details to create a new task for this project."
            }
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="project_id"
              render={({ field }) => (
                <FormItem style={{ display: 'none' }}>
                  <FormControl>
                    <Input type="hidden" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Task Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter task name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter task description (optional)"
                      rows={4}
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={createTask.isPending || updateTask.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createTask.isPending || updateTask.isPending}
              >
                {createTask.isPending || updateTask.isPending ? "Saving..." : (isEditing ? "Update Task" : "Create Task")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
