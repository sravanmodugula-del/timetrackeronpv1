import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import Header from "@/components/layout/header";
import { PageLayout } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building, Plus, Edit2, Trash2, Users, Calendar } from "lucide-react";
import type { Department } from "@shared/schema";

export default function Departments() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const { canCreateDepartments, canEditDepartments, canDeleteDepartments } = usePermissions();
  const queryClient = useQueryClient();

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

  // Fetch departments
  const { data: departments = [], isLoading: departmentsLoading } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
    enabled: isAuthenticated,
  });

  // Delete department mutation
  const deleteDepartment = useMutation({
    mutationFn: async (departmentId: string) => {
      await apiRequest(`/api/departments/${departmentId}`, "DELETE");
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Department deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
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
        description: "Failed to delete department",
        variant: "destructive",
      });
    },
  });

  const handleDelete = (departmentId: string) => {
    if (confirm("Are you sure you want to delete this department?")) {
      deleteDepartment.mutate(departmentId);
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
    <PageLayout
      title="Departments"
      subtitle="Manage departments and organizational units"
      actions={
        canCreateDepartments && (
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Department
          </Button>
        )
      }
    >
      {departmentsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="flex items-center space-x-3">
                  <div className="w-6 h-6 bg-gray-200 rounded"></div>
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
      ) : departments.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Building className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No departments</h3>
            <p className="text-gray-500 mb-4">
              Get started by creating your first department.
            </p>
            {canCreateDepartments && (
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                New Department
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {departments.map((department) => (
            <Card key={department.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Building className="w-6 h-6 text-primary" />
                    <div>
                      <CardTitle className="text-lg">{department.name}</CardTitle>
                    </div>
                  </div>
                  <div className="flex space-x-1">
                    {canEditDepartments && (
                      <Button variant="ghost" size="sm">
                        <Edit2 className="w-4 h-4" />
                      </Button>
                    )}
                    {canDeleteDepartments && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(department.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {department.description && (
                    <p className="text-sm text-gray-600 line-clamp-2">
                      {department.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <div className="flex items-center space-x-1">
                      <Calendar className="w-4 h-4" />
                      <span>Created {new Date(department.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {department.code && (
                    <div className="text-sm">
                      <span className="text-gray-500">Code: </span>
                      <Badge variant="outline">{department.code}</Badge>
                    </div>
                  )}

                  {department.manager_id && (
                    <div className="text-sm">
                      <span className="text-gray-500">Manager: </span>
                      <span className="font-medium">{department.manager_id}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageLayout>
  );
}