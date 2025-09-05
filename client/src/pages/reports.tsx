import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import Header from "@/components/layout/header";
import PageLayout from "@/components/layout/page-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3,
  Download,
  Calendar as CalendarIcon,
  TrendingUp,
  Clock,
  Users,
  Building,
  Filter
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

export default function Reports() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const permissions = usePermissions();
  const [dateRange, setDateRange] = useState<string>("week");
  const [reportType, setReportType] = useState<string>("time-summary");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

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

  const reportTypes = [
    { value: "time-summary", label: "Time Summary", icon: Clock },
    { value: "project-breakdown", label: "Project Breakdown", icon: BarChart3 },
    { value: "employee-hours", label: "Employee Hours", icon: Users },
    { value: "department-analysis", label: "Department Analysis", icon: Building },
  ];

  const handleExport = () => {
    toast({
      title: "Export Started",
      description: "Your report is being generated and will download shortly.",
    });
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

  // Added check for permissions to display the report section
  if (!permissions.canViewReports) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="p-8 text-center">
              <Filter className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Access Denied</h3>
              <p className="text-gray-600">You don't have permission to view reports.</p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <PageLayout
      title="Reports"
      subtitle="Generate and analyze time tracking reports"
      actions={
        <Button onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          Export Report
        </Button>
      }
    >
      {/* Report Configuration */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Report Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Report Type */}
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger>
                <SelectValue placeholder="Select report type" />
              </SelectTrigger>
              <SelectContent>
                {reportTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    <div className="flex items-center gap-2">
                      <type.icon className="w-4 h-4" />
                      {type.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Date Range */}
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger>
                <SelectValue placeholder="Select date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="quarter">This Quarter</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>

            {/* Custom Date Picker */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "justify-start text-left font-normal",
                    !selectedDate && "text-muted-foreground"
                  )}
                  disabled={dateRange !== "custom"}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </CardContent>
      </Card>

      {/* Report Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Hours</p>
                <p className="text-2xl font-bold">156.5</p>
              </div>
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="flex items-center mt-4 text-sm">
              <TrendingUp className="mr-1 h-4 w-4 text-green-600" />
              <span className="text-green-600">+12.5%</span>
              <span className="text-muted-foreground ml-1">from last period</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Projects</p>
                <p className="text-2xl font-bold">8</p>
              </div>
              <BarChart3 className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="flex items-center mt-4 text-sm">
              <span className="text-blue-600">2 new</span>
              <span className="text-muted-foreground ml-1">this period</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Contributors</p>
                <p className="text-2xl font-bold">24</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="flex items-center mt-4 text-sm">
              <span className="text-muted-foreground">Across 5 departments</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Daily Hours</p>
                <p className="text-2xl font-bold">7.8</p>
              </div>
              <TrendingUp className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="flex items-center mt-4 text-sm">
              <span className="text-green-600">+0.3</span>
              <span className="text-muted-foreground ml-1">from target</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Report Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Report Preview</span>
            <Badge variant="secondary">
              {reportTypes.find(t => t.value === reportType)?.label}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <BarChart3 className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Report Preview
            </h3>
            <p className="text-gray-500 mb-6 max-w-md mx-auto">
              Configure your report settings above and the preview will appear here.
              You can then export the full report in various formats.
            </p>
            <div className="flex justify-center space-x-4">
              <Button variant="outline">
                <BarChart3 className="w-4 h-4 mr-2" />
                Generate Chart
              </Button>
              <Button>
                <Download className="w-4 h-4 mr-2" />
                Export Data
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </PageLayout>
  );
}