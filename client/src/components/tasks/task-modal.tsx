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
  }, [isOpen, projectId, task, isEditing]);

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      project_id: projectId,
      name: task?.name || "",
      description: task?.description || "",
      status: (task?.status as "active" | "completed" | "archived") || "active",
    },
    mode: "onChange",
  });

  // Debug form state changes
  useEffect(() => {
    const subscription = form.watch((value, { name, type }) => {
      console.log("📝 Form field changed:", { name, type, value, formState: form.formState });
    });
    return () => subscription.unsubscribe();
  }, [form]);

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
        project_id: data.project_id.trim()
      };

      console.log("🔧 Creating task with payload:", payload);
      console.log("🔧 Using correct API endpoint: /api/tasks");
      const response = await apiRequest("/api/tasks", "POST", payload);
      console.log("✅ Task creation response:", response);
      return response;
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
    console.log("🚀 FORM SUBMITTED - Starting debug trace");
    console.log("📝 Form data received:", data);
    console.log("📊 Complete form state:", {
      isEditing,
      projectId,
      hasProjectId: !!data.project_id,
      hasName: !!data.name,
      formValues: form.getValues(),
      formState: {
        isValid: form.formState.isValid,
        isValidating: form.formState.isValidating,
        isSubmitting: form.formState.isSubmitting,
        errors: form.formState.errors,
        isDirty: form.formState.isDirty,
        dirtyFields: form.formState.dirtyFields,
        touchedFields: form.formState.touchedFields
      }
    });

    // Manual validation check
    if (!data.name || data.name.trim() === "") {
      console.error("❌ Validation failed: Name is required");
      form.setError("name", { message: "Task name is required" });
      return;
    }

    if (!data.project_id || data.project_id.trim() === "") {
      console.error("❌ Validation failed: Project ID is required");
      form.setError("project_id", { message: "Project ID is required" });
      return;
    }

    console.log("✅ Manual validation passed");
    console.log("🎯 Mutation selection:", {
      isEditing,
      willCallUpdateTask: isEditing,
      willCallCreateTask: !isEditing
    });

    try {
      if (isEditing) {
        console.log("📤 Calling updateTask.mutate with data:", data);
        updateTask.mutate(data);
      } else {
        console.log("📤 Calling createTask.mutate with data:", data);
        createTask.mutate(data);
      }
    } catch (error) {
      console.error("💥 Error in onSubmit:", error);
    }
  };

  // Force submission handler
  const handleForceSubmit = () => {
    console.log("🔥 FORCE SUBMIT TRIGGERED");
    const currentValues = form.getValues();
    console.log("🔥 Current form values:", currentValues);
    
    // Force validation first
    form.trigger().then((isValid) => {
      console.log("🔥 Force validation result:", isValid);
      if (isValid) {
        console.log("🔥 Calling onSubmit directly");
        onSubmit(currentValues);
      } else {
        console.log("🔥 Force validation failed:", form.formState.errors);
      }
    });
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
                onClick={() => {
                  console.log("🔙 Cancel button clicked");
                  onClose();
                }}
                disabled={createTask.isPending || updateTask.isPending}
              >
                Cancel
              </Button>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={createTask.isPending || updateTask.isPending}
                  onClick={(e) => {
                    console.log("🖱️ Submit button clicked - Debug info:");
                    console.log("📊 Current form state:", {
                      isValid: form.formState.isValid,
                      errors: form.formState.errors,
                      values: form.getValues(),
                      isDirty: form.formState.isDirty
                    });
                    console.log("🎯 Button event:", e.type);
                    
                    // Don't prevent default here - let the form handle it
                  }}
                >
                  {createTask.isPending || updateTask.isPending ? "Saving..." : (isEditing ? "Update Task" : "Create Task")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleForceSubmit}
                  disabled={createTask.isPending || updateTask.isPending}
                >
                  Force Submit
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
