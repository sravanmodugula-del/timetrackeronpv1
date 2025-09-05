import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import Header from "@/components/layout/header";
import PageLayout from "@/components/layout/page-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Shield, User, CheckCircle, XCircle, Crown, Users } from "lucide-react";

export default function RoleTesting() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const permissions = usePermissions();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Shield className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Authentication Required</h3>
          <p className="text-gray-500">Please log in to access this page.</p>
        </div>
      </div>
    );
  }

  const getRoleIcon = (role: string) => {
    switch (role?.toLowerCase()) {
      case "admin":
        return <Crown className="w-4 h-4" />;
      case "manager":
        return <Shield className="w-4 h-4" />;
      case "employee":
        return <User className="w-4 h-4" />;
      default:
        return <User className="w-4 h-4" />;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role?.toLowerCase()) {
      case "admin":
        return "bg-red-100 text-red-700";
      case "manager":
        return "bg-blue-100 text-blue-700";
      case "employee":
        return "bg-green-100 text-green-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  const PermissionCheck = ({ 
    permission, 
    label 
  }: { 
    permission: boolean; 
    label: string; 
  }) => (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        {permission ? (
          <CheckCircle className="w-4 h-4 text-green-600" />
        ) : (
          <XCircle className="w-4 h-4 text-red-600" />
        )}
        <Badge variant={permission ? "default" : "secondary"} className="text-xs">
          {permission ? "Allowed" : "Denied"}
        </Badge>
      </div>
    </div>
  );

  return (
    <PageLayout
      title="Role & Permissions Testing"
      subtitle="Test and verify user roles and permissions"
    >
      {/* User Information */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Current User Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div>
                <span className="text-sm font-medium text-gray-500">Display Name:</span>
                <p className="text-sm">{user?.display_name || "Not set"}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-500">Username:</span>
                <p className="text-sm">{user?.username || "Not set"}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-500">Email:</span>
                <p className="text-sm">{user?.email || "Not set"}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <span className="text-sm font-medium text-gray-500">Role:</span>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={getRoleColor(user?.role || "employee")}>
                    {getRoleIcon(user?.role || "employee")}
                    <span className="ml-1 capitalize">{user?.role || "Employee"}</span>
                  </Badge>
                </div>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-500">Auth Context Role:</span>
                <p className="text-sm">{user?.authContext?.role || "Not set"}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-500">User ID:</span>
                <p className="text-sm font-mono text-xs">{user?.id || "Not set"}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Permissions Testing */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Project Permissions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="w-5 h-5" />
              Project Permissions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <PermissionCheck 
                permission={permissions.canCreateProjects} 
                label="Create Projects" 
              />
              <PermissionCheck 
                permission={permissions.canEditProjects} 
                label="Edit Projects" 
              />
              <PermissionCheck 
                permission={permissions.canDeleteProjects} 
                label="Delete Projects" 
              />
              <PermissionCheck 
                permission={permissions.canViewAllProjects} 
                label="View All Projects" 
              />
            </div>
          </CardContent>
        </Card>

        {/* Task Permissions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CheckCircle className="w-5 h-5" />
              Task Permissions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <PermissionCheck 
                permission={permissions.canCreateTasks} 
                label="Create Tasks" 
              />
              <PermissionCheck 
                permission={permissions.canEditTasks} 
                label="Edit Tasks" 
              />
              <PermissionCheck 
                permission={permissions.canDeleteTasks} 
                label="Delete Tasks" 
              />
              <PermissionCheck 
                permission={permissions.canViewAllTasks} 
                label="View All Tasks" 
              />
            </div>
          </CardContent>
        </Card>

        {/* Time Entry Permissions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="w-5 h-5" />
              Time Entry Permissions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <PermissionCheck 
                permission={permissions.canCreateTimeEntries} 
                label="Create Time Entries" 
              />
              <PermissionCheck 
                permission={permissions.canEditTimeEntries} 
                label="Edit Time Entries" 
              />
              <PermissionCheck 
                permission={permissions.canDeleteTimeEntries} 
                label="Delete Time Entries" 
              />
              <PermissionCheck 
                permission={permissions.canViewAllTimeEntries} 
                label="View All Time Entries" 
              />
            </div>
          </CardContent>
        </Card>

        {/* Management Permissions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Crown className="w-5 h-5" />
              Management Permissions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <PermissionCheck 
                permission={permissions.canManageUsers} 
                label="Manage Users" 
              />
              <PermissionCheck 
                permission={permissions.canCreateEmployees} 
                label="Create Employees" 
              />
              <PermissionCheck 
                permission={permissions.canEditEmployees} 
                label="Edit Employees" 
              />
              <PermissionCheck 
                permission={permissions.canDeleteEmployees} 
                label="Delete Employees" 
              />
              <PermissionCheck 
                permission={permissions.canCreateOrganizations} 
                label="Create Organizations" 
              />
              <PermissionCheck 
                permission={permissions.canCreateDepartments} 
                label="Create Departments" 
              />
              <PermissionCheck 
                permission={permissions.canViewDepartmentData} 
                label="View Department Data" 
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Raw Permission Data */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Raw Permissions Object (Debug)</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs bg-gray-50 p-4 rounded overflow-auto">
            {JSON.stringify(permissions, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </PageLayout>
  );
}