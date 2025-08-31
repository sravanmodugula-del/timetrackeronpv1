import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api, isApiError } from "@/lib/utils";
import { Building, Plus, Search, Edit, Trash2, FolderOpen, AlertCircle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import Header from "@/components/layout/header";

// Enhanced type definitions with better organization structure
type Organization = {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  user_id: string;
  department_count?: number;
  project_count?: number;
};

// Enhanced form validation schema with better error messages
const organizationFormSchema = z.object({
  name: z
    .string()
    .min(1, "Organization name is required")
    .max(255, "Organization name must be less than 255 characters")
    .regex(/^[a-zA-Z0-9\s\-_\.]+$/, "Organization name contains invalid characters"),
  description: z
    .string()
    .max(1000, "Description must be less than 1000 characters")
    .optional()
    .or(z.literal("")),
});

type OrganizationFormData = z.infer<typeof organizationFormSchema>;

// Constants for better maintainability
const QUERY_KEYS = {
  ORGANIZATIONS: ["/api/organizations"] as const,
  DEPARTMENTS: ["/api/departments"] as const,
} as const;

const UI_CONSTANTS = {
  SEARCH_DEBOUNCE_MS: 300,
  TOAST_DURATION: 3000,
  MAX_DESCRIPTION_LENGTH: 1000,
} as const;

export default function Organizations() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const { canManageSystem } = usePermissions();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrganization, setEditingOrganization] = useState<Organization | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Debounce search term for performance optimization
  const debouncedSearchTerm = useMemo(() => {
    const handler = setTimeout(() => {
      setSearchTerm(searchTerm);
    }, UI_CONSTANTS.SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(handler);
  }, [searchTerm]);

  useEffect(() => {
    debouncedSearchTerm();
    return () => debouncedSearchTerm();
  }, [searchTerm, debouncedSearchTerm]);

  // Handle authentication and authorization checks
  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      toast({
        title: "Authentication Required",
        description: "Please log in to access this page.",
        variant: "destructive",
        duration: UI_CONSTANTS.TOAST_DURATION,
      });
      window.location.href = "/api/login";
      return;
    }

    if (!canManageSystem) {
      toast({
        title: "Access Denied",
        description: "Administrator access is required to manage organizations.",
        variant: "destructive",
        duration: UI_CONSTANTS.TOAST_DURATION,
      });
      window.location.href = "/";
      return;
    }
  }, [isAuthenticated, isLoading, canManageSystem, toast]);

  // Form setup with enhanced validation and better UX
  const form = useForm<OrganizationFormData>({
    resolver: zodResolver(organizationFormSchema),
    defaultValues: {
      name: "",
      description: "",
    },
    mode: "onChange", // Real-time validation
  });

  // Optimized query with proper error handling and retry logic
  const { 
    data: organizations = [], 
    isLoading: organizationsLoading,
    error: organizationsError,
    refetch: refetchOrganizations
  } = useQuery({
    queryKey: QUERY_KEYS.ORGANIZATIONS,
    queryFn: async () => {
      try {
        const response = await api("/api/organizations", "GET");
        return response as Organization[];
      } catch (error) {
        if (isApiError(error)) {
          throw new Error("Authentication failed. Please log in again.");
        }
        throw new Error("Failed to load organizations. Please try again.");
      }
    },
    retry: (failureCount, error) => {
      // Don't retry auth errors, retry other errors up to 2 times
      if (error?.message?.includes("Authentication")) return false;
      return failureCount < 2;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // Enhanced create mutation with better error handling
  const createOrganization = useMutation({
    mutationFn: async (data: OrganizationFormData) => {
      try {
        const response = await api("/api/organizations", "POST", {
          ...data,
          name: data.name.trim(),
          description: data.description?.trim() || undefined,
        });
        return response as Organization;
      } catch (error) {
        if (isApiError(error)) {
          throw new Error("Authentication failed. Please log in again.");
        }
        throw new Error(error?.message || "Failed to create organization");
      }
    },
    onSuccess: (newOrganization) => {
      toast({
        title: "Organization Created",
        description: `"${newOrganization.name}" has been created successfully.`,
        duration: UI_CONSTANTS.TOAST_DURATION,
      });

      // Efficiently update cache instead of invalidating
      queryClient.setQueryData(QUERY_KEYS.ORGANIZATIONS, (old: Organization[] = []) => [
        newOrganization,
        ...old
      ]);

      // Close modal and reset form
      setIsModalOpen(false);
      setEditingOrganization(null);
      form.reset();
    },
    onError: (error: Error) => {
      if (error.message.includes("Authentication")) {
        toast({
          title: "Authentication Required",
          description: "Please log in again to continue.",
          variant: "destructive",
          duration: UI_CONSTANTS.TOAST_DURATION,
        });
        window.location.href = "/api/login";
        return;
      }

      toast({
        title: "Creation Failed",
        description: error.message,
        variant: "destructive",
        duration: UI_CONSTANTS.TOAST_DURATION,
      });
    },
  });

  // Enhanced update mutation with optimistic updates
  const updateOrganization = useMutation({
    mutationFn: async (data: OrganizationFormData) => {
      if (!editingOrganization) {
        throw new Error("No organization selected for editing");
      }

      try {
        const response = await api(`/api/organizations/${editingOrganization.id}`, "PUT", {
          ...data,
          name: data.name.trim(),
          description: data.description?.trim() || undefined,
        });
        return response as Organization;
      } catch (error) {
        if (isApiError(error)) {
          throw new Error("Authentication failed. Please log in again.");
        }
        throw new Error(error?.message || "Failed to update organization");
      }
    },
    onMutate: async (data) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.ORGANIZATIONS });

      // Snapshot previous value
      const previousOrganizations = queryClient.getQueryData(QUERY_KEYS.ORGANIZATIONS);

      // Optimistically update
      if (editingOrganization) {
        queryClient.setQueryData(QUERY_KEYS.ORGANIZATIONS, (old: Organization[] = []) =>
          old.map(org => 
            org.id === editingOrganization.id 
              ? { ...org, ...data, name: data.name.trim() }
              : org
          )
        );
      }

      return { previousOrganizations };
    },
    onSuccess: (updatedOrganization) => {
      toast({
        title: "Organization Updated",
        description: `"${updatedOrganization.name}" has been updated successfully.`,
        duration: UI_CONSTANTS.TOAST_DURATION,
      });

      // Close modal and reset form
      setIsModalOpen(false);
      setEditingOrganization(null);
      form.reset();
    },
    onError: (error: Error, _, context) => {
      // Rollback optimistic update
      if (context?.previousOrganizations) {
        queryClient.setQueryData(QUERY_KEYS.ORGANIZATIONS, context.previousOrganizations);
      }

      if (error.message.includes("Authentication")) {
        toast({
          title: "Authentication Required",
          description: "Please log in again to continue.",
          variant: "destructive",
          duration: UI_CONSTANTS.TOAST_DURATION,
        });
        window.location.href = "/api/login";
        return;
      }

      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
        duration: UI_CONSTANTS.TOAST_DURATION,
      });
    },
  });

  // Enhanced delete mutation with dependency checking
  const deleteOrganization = useMutation({
    mutationFn: async (id: string) => {
      try {
        await api(`/api/organizations/${id}`, "DELETE");
        return id;
      } catch (error) {
        if (isApiError(error)) {
          throw new Error("Authentication failed. Please log in again.");
        }

        // Handle specific deletion errors
        if (error?.message?.includes("department")) {
          throw new Error("Cannot delete organization: Please remove all departments first.");
        }
        if (error?.message?.includes("project")) {
          throw new Error("Cannot delete organization: Please remove all projects first.");
        }

        throw new Error(error?.message || "Failed to delete organization");
      }
    },
    onMutate: async (id) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.ORGANIZATIONS });

      // Snapshot previous value
      const previousOrganizations = queryClient.getQueryData(QUERY_KEYS.ORGANIZATIONS);

      // Optimistically remove from cache
      queryClient.setQueryData(QUERY_KEYS.ORGANIZATIONS, (old: Organization[] = []) =>
        old.filter(org => org.id !== id)
      );

      return { previousOrganizations, deletedId: id };
    },
    onSuccess: (deletedId, _, context) => {
      const deletedOrg = (context?.previousOrganizations as Organization[] || [])
        .find(org => org.id === deletedId);

      toast({
        title: "Organization Deleted",
        description: `"${deletedOrg?.name || 'Organization'}" has been deleted successfully.`,
        duration: UI_CONSTANTS.TOAST_DURATION,
      });

      setDeleteConfirmId(null);
    },
    onError: (error: Error, _, context) => {
      // Rollback optimistic update
      if (context?.previousOrganizations) {
        queryClient.setQueryData(QUERY_KEYS.ORGANIZATIONS, context.previousOrganizations);
      }

      if (error.message.includes("Authentication")) {
        toast({
          title: "Authentication Required",
          description: "Please log in again to continue.",
          variant: "destructive",
          duration: UI_CONSTANTS.TOAST_DURATION,
        });
        window.location.href = "/api/login";
        return;
      }

      toast({
        title: "Deletion Failed",
        description: error.message,
        variant: "destructive",
        duration: UI_CONSTANTS.TOAST_DURATION,
      });

      setDeleteConfirmId(null);
    },
  });

  // Handler for submitting the form (create or update)
  const onSubmit = (data: OrganizationFormData) => {
    if (editingOrganization) {
      updateOrganization.mutate(data);
    } else {
      createOrganization.mutate(data);
    }
  };

  // Handler to populate form and open modal for editing
  const handleEdit = useCallback((organization: Organization) => {
    setEditingOrganization(organization);
    form.reset({
      name: organization.name,
      description: organization.description || "",
    });
    setIsModalOpen(true);
  }, [form]);

  // Handler to initiate the delete confirmation process
  const handleDeleteClick = (organization: Organization) => {
    setDeleteConfirmId(organization.id);
  };

  // Handler for confirming deletion
  const handleConfirmDelete = () => {
    if (deleteConfirmId) {
      deleteOrganization.mutate(deleteConfirmId);
    }
  };

  // Filter organizations based on search term
  const filteredOrganizations = useMemo(() => {
    return organizations.filter(organization =>
      organization.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (organization.description && organization.description.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [organizations, searchTerm]);

  // Handle initial loading state
  if (isLoading) {
    return null; // Or a loading spinner component
  }

  // Handle errors during organization fetching
  if (organizationsError) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <AlertCircle className="h-16 w-16 text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Error Loading Organizations</h2>
        <p className="text-gray-600 mb-6">{organizationsError.message}</p>
        <Button onClick={() => refetchOrganizations()} className="flex items-center">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Retry
        </Button>
      </div>
    );
  }

  // Main component rendering
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Header Section */}
        <div className="md:flex md:items-center md:justify-between mb-8">
          <div className="flex-1 min-w-0">
            <div className="flex items-center">
              <Building className="w-8 h-8 text-blue-600 mr-3" />
              <div>
                <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate">
                  Organization Management
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Manage organizations where departments roll up
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex md:mt-0 md:ml-4">
            {canManageSystem && (
              <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogTrigger asChild>
                  <Button onClick={() => { setEditingOrganization(null); form.reset(); }}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Organization
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>
                      {editingOrganization ? "Edit Organization" : "Add New Organization"}
                    </DialogTitle>
                    <DialogDescription>
                      {editingOrganization
                        ? "Update the organization details below."
                        : "Create a new organization to group departments under."
                      }
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Organization Name *</FormLabel>
                            <FormControl>
                              <Input placeholder="Enter organization name" {...field} />
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
                            <FormLabel>Description (optional)</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Describe the organization..."
                                className="resize-none"
                                rows={3}
                                {...field}
                                value={field.value ?? ""} // Ensure value is never undefined for controlled input
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <DialogFooter>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setIsModalOpen(false);
                            setEditingOrganization(null);
                            form.reset();
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          disabled={createOrganization.isPending || updateOrganization.isPending}
                        >
                          {createOrganization.isPending || updateOrganization.isPending
                            ? "Saving..."
                            : editingOrganization
                            ? "Update Organization"
                            : "Create Organization"
                          }
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {/* Search Input */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search organizations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Organizations Grid - Loading State */}
        {organizationsLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-gray-200 rounded"></div>
                    <div className="h-5 w-32 bg-gray-200 rounded"></div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="h-4 w-full bg-gray-200 rounded"></div>
                    <div className="h-4 w-3/4 bg-gray-200 rounded"></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Organizations Grid - No Results Found */}
        {!organizationsLoading && filteredOrganizations.length === 0 && (
          <div className="text-center py-12">
            <Building className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">
              {searchTerm ? "No organizations found matching your search." : "No organizations available."}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {searchTerm
                ? "Try adjusting your search terms or clearing the search bar."
                : "Get started by creating a new organization."
              }
            </p>
            {!searchTerm && canManageSystem && (
              <div className="mt-6">
                <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={() => { setEditingOrganization(null); form.reset(); }}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Organization
                    </Button>
                  </DialogTrigger>
                </Dialog>
              </div>
            )}
          </div>
        )}

        {/* Organizations Grid - Displaying Results */}
        {!organizationsLoading && filteredOrganizations.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredOrganizations.map((organization) => (
              <Card key={organization.id} className="hover:shadow-md transition-shadow flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Building className="w-6 h-6 text-blue-600" />
                      <CardTitle className="text-lg break-all">{organization.name}</CardTitle>
                    </div>
                    {canManageSystem && (
                      <div className="flex space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(organization)}
                          aria-label={`Edit ${organization.name}`}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <AlertDialog open={deleteConfirmId === organization.id} onOpenChange={(isOpen) => !isOpen && setDeleteConfirmId(null)}>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteClick(organization)}
                              aria-label={`Delete ${organization.name}`}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure you want to delete "{organization.name}"?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action cannot be undone. All associated departments and projects will also be removed.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel onClick={() => setDeleteConfirmId(null)}>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={handleConfirmDelete} className="bg-red-600 hover:bg-red-700">
                                {deleteOrganization.isPending ? "Deleting..." : "Delete"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-grow">
                  {organization.description && (
                    <CardDescription className="text-sm text-gray-600 mb-4 line-clamp-3">
                      {organization.description}
                    </CardDescription>
                  )}

                  <div className="flex items-center justify-between text-sm text-gray-500 mt-auto">
                    <span>Created: {organization.createdAt ? new Date(organization.createdAt).toLocaleDateString() : 'N/A'}</span>
                    <Badge variant="outline" className="text-xs">
                      <FolderOpen className="w-3 h-3 mr-1" />
                      Organization
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}