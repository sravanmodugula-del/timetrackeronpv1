import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import Header from "@/components/layout/header";
import PageLayout from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, Edit2, Trash2, Users, Calendar } from "lucide-react";
import type { Organization } from "@shared/schema";

export default function Organizations() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const { canCreateOrganizations, canEditOrganizations, canDeleteOrganizations } = usePermissions();
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

  // Fetch organizations
  const { data: organizations = [], isLoading: organizationsLoading } = useQuery<Organization[]>({
    queryKey: ["/api/organizations"],
    enabled: isAuthenticated,
  });

  // Delete organization mutation
  const deleteOrganization = useMutation({
    mutationFn: async (organizationId: string) => {
      await apiRequest(`/api/organizations/${organizationId}`, "DELETE");
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Organization deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
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
        description: "Failed to delete organization",
        variant: "destructive",
      });
    },
  });

  const handleDelete = (organizationId: string) => {
    if (confirm("Are you sure you want to delete this organization?")) {
      deleteOrganization.mutate(organizationId);
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
      title="Organizations"
      subtitle="Manage organizational structure and hierarchy"
      actions={
        canCreateOrganizations && (
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Organization
          </Button>
        )
      }
    >
      {organizationsLoading ? (
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
      ) : organizations.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Building2 className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No organizations</h3>
            <p className="text-gray-500 mb-4">
              Get started by creating your first organization.
            </p>
            {canCreateOrganizations && (
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                New Organization
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {organizations.map((organization) => (
            <Card key={organization.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Building2 className="w-6 h-6 text-primary" />
                    <div>
                      <CardTitle className="text-lg">{organization.name}</CardTitle>
                    </div>
                  </div>
                  <div className="flex space-x-1">
                    {canEditOrganizations && (
                      <Button variant="ghost" size="sm">
                        <Edit2 className="w-4 h-4" />
                      </Button>
                    )}
                    {canDeleteOrganizations && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(organization.id)}
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
                  {organization.description && (
                    <p className="text-sm text-gray-600 line-clamp-2">
                      {organization.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <div className="flex items-center space-x-1">
                      <Calendar className="w-4 h-4" />
                      <span>Created {new Date(organization.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {organization.website && (
                    <div className="text-sm">
                      <span className="text-gray-500">Website: </span>
                      <a
                        href={organization.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {organization.website}
                      </a>
                    </div>
                  )}

                  {organization.industry && (
                    <Badge variant="secondary" className="w-fit">
                      {organization.industry}
                    </Badge>
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