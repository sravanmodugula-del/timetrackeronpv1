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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Plus, Edit2, Trash2, Search, Filter } from "lucide-react";
import type { Employee, Department } from "@shared/schema";

export default function Employees() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const { canCreateEmployees, canEditEmployees, canDeleteEmployees } = usePermissions();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");

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

  // Fetch employees
  const { data: employees = [], isLoading: employeesLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
    enabled: isAuthenticated,
  });

  // Fetch departments for filter
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
    enabled: isAuthenticated,
  });

  // Delete employee mutation
  const deleteEmployee = useMutation({
    mutationFn: async (employeeId: string) => {
      await apiRequest(`/api/employees/${employeeId}`, "DELETE");
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Employee deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
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
        description: "Failed to delete employee",
        variant: "destructive",
      });
    },
  });

  const handleDelete = (employeeId: string) => {
    if (confirm("Are you sure you want to delete this employee?")) {
      deleteEmployee.mutate(employeeId);
    }
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  };

  const getRoleColor = (role: string) => {
    switch (role.toLowerCase()) {
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

  // Filter employees
  const filteredEmployees = employees.filter((employee) => {
    const matchesSearch = 
      employee.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      employee.last_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      employee.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      employee.employee_id.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesDepartment = selectedDepartment === "all" || employee.department === selectedDepartment;

    return matchesSearch && matchesDepartment;
  });

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
      title="Employees"
      subtitle="Manage employee information and access"
      actions={
        canCreateEmployees && (
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Add Employee
          </Button>
        )
      }
    >
      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search employees..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Department Filter */}
            <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.name}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Employees Grid */}
      {employeesLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-gray-200 rounded-full"></div>
                  <div className="space-y-2 flex-1">
                    <div className="h-4 w-3/4 bg-gray-200 rounded"></div>
                    <div className="h-3 w-1/2 bg-gray-200 rounded"></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredEmployees.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Users className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {employees.length === 0 ? "No employees" : "No employees found"}
            </h3>
            <p className="text-gray-500 mb-4">
              {employees.length === 0 
                ? "Get started by adding your first employee."
                : "Try adjusting your search or filter criteria."
              }
            </p>
            {canCreateEmployees && employees.length === 0 && (
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Employee
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredEmployees.map((employee) => (
            <Card key={employee.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    <Avatar className="w-12 h-12">
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {getInitials(employee.first_name, employee.last_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        {employee.first_name} {employee.last_name}
                      </h3>
                      <p className="text-sm text-gray-500">{employee.email}</p>
                    </div>
                  </div>
                  <div className="flex space-x-1">
                    {canEditEmployees && (
                      <Button variant="ghost" size="sm">
                        <Edit2 className="w-4 h-4" />
                      </Button>
                    )}
                    {canDeleteEmployees && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(employee.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Employee ID:</span>
                    <span className="font-medium">{employee.employee_id}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Department:</span>
                    <span>{employee.department}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Role:</span>
                    <Badge className={getRoleColor(employee.role || "employee")}>
                      {employee.role || "Employee"}
                    </Badge>
                  </div>
                  {employee.hire_date && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Hire Date:</span>
                      <span>{new Date(employee.hire_date).toLocaleDateString()}</span>
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