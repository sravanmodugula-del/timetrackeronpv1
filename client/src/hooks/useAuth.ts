
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from '@/lib/queryClient';

export interface AuthContext {
  role: string;
  permissions: string[];
  departmentId?: string;
  organizationId?: string;
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: string;
  authContext?: AuthContext;
}

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<AuthenticatedUser>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const logout = useMutation({
    mutationFn: async () => {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      // Redirect to login page after logout
      window.location.href = '/login';
    }
  });

  return {
    user,
    isAuthenticated: !!user && !error,
    isLoading,
    error,
    logout: logout.mutate
  };
}

// Permission checking hooks
export function usePermissions() {
  const { user } = useAuth();

  const permissions = user?.authContext?.permissions || [];

  const hasPermission = (permission: string) => {
    return permissions.includes(permission) || permissions.includes('system_admin');
  };

  const hasAnyPermission = (requiredPermissions: string[]) => {
    return requiredPermissions.some(permission => hasPermission(permission));
  };

  const hasAllPermissions = (requiredPermissions: string[]) => {
    return requiredPermissions.every(permission => hasPermission(permission));
  };

  return {
    permissions,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
  };
}

// Role checking hook
export function useRole() {
  const { user } = useAuth();
  const role = user?.authContext?.role || 'employee';

  const isAdmin = () => role === 'admin';
  const isManager = () => role === 'manager';
  const isEmployee = () => role === 'employee';
  const isViewer = () => role === 'viewer';

  const hasRole = (requiredRole: string) => role === requiredRole;
  const hasAnyRole = (requiredRoles: string[]) => requiredRoles.includes(role);

  return {
    role,
    isAdmin,
    isManager,
    isEmployee,
    isViewer,
    hasRole,
    hasAnyRole,
  };
}
