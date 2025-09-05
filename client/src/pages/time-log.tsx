import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import Header from "@/components/layout/header";
import { PageLayout } from "@/components/layout/page-layout";
import EnhancedTimeEntryModal from "@/components/time/enhanced-time-entry-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Edit2, Trash2, Calendar as CalendarIcon, Clock, Play, Pause, Square, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { TimeEntry, Project, Task } from "@shared/schema";

export default function TimeLog() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const { canCreateTimeEntries, canEditTimeEntries, canDeleteTimeEntries } = usePermissions();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedProject, setSelectedProject] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  // Fetch projects for filter
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
    enabled: isAuthenticated,
  });

  // Fetch time entries
  const { data: timeEntries = [], refetch } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries", {
      date: format(selectedDate, "yyyy-MM-dd"),
      projectId: selectedProject === "all" ? undefined : selectedProject,
      status: selectedStatus === "all" ? undefined : selectedStatus,
    }],
    enabled: isAuthenticated,
    queryFn: async () => {
      let url = `/api/time-entries?date=${format(selectedDate, "yyyy-MM-dd")}`;
      if (selectedProject !== "all") {
        url += `&projectId=${selectedProject}`;
      }
      if (selectedStatus !== "all") {
        url += `&status=${selectedStatus}`;
      }
      return apiRequest(url, "GET");
    },
  });

  // Delete time entry mutation
  const deleteEntry = useMutation({
    mutationFn: async (entryId: string) => {
      await apiRequest(`/api/time-entries/${entryId}`, "DELETE");
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Time entry deleted successfully",
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
        description: "Failed to delete time entry",
        variant: "destructive",
      });
    },
  });

  const formatDuration = (hours: number) => {
    const wholeHours = Math.floor(hours);
    const minutes = Math.round((hours - wholeHours) * 60);
    return `${wholeHours}h ${minutes}m`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "bg-green-100 text-green-700";
      case "paused":
        return "bg-yellow-100 text-yellow-700";
      case "stopped":
        return "bg-blue-100 text-blue-700";
      case "completed":
        return "bg-gray-100 text-gray-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "running":
        return <Play className="w-3 h-3" />;
      case "paused":
        return <Pause className="w-3 h-3" />;
      case "stopped":
      case "completed":
        return <Square className="w-3 h-3" />;
      default:
        return <Clock className="w-3 h-3" />;
    }
  };

  const handleEdit = (entry: TimeEntry) => {
    setEditingEntry(entry);
    setIsModalOpen(true);
  };

  const handleDelete = (entryId: string) => {
    if (confirm("Are you sure you want to delete this time entry?")) {
      deleteEntry.mutate(entryId);
    }
  };

  const handleCreateNew = () => {
    setEditingEntry(null);
    setIsModalOpen(true);
  };

  const totalHours = timeEntries.reduce((sum, entry) => sum + (entry.duration || 0), 0);

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
      title="Time Log"
      subtitle="View and manage your time entries"
      actions={
        canCreateTimeEntries && (
          <Button onClick={handleCreateNew}>
            <Plus className="w-4 h-4 mr-2" />
            New Entry
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
            {/* Date Picker */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-64 justify-start text-left font-normal",
                    !selectedDate && "text-muted-foreground"
                  )}
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

            {/* Project Filter */}
            <Select value={selectedProject} onValueChange={setSelectedProject}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Status Filter */}
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="stopped">Stopped</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">
                {format(selectedDate, "MMMM d, yyyy")}
              </h3>
              <p className="text-muted-foreground">
                {timeEntries.length} {timeEntries.length === 1 ? "entry" : "entries"}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold">{formatDuration(totalHours)}</div>
              <div className="text-muted-foreground">Total Time</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Time Entries */}
      <div className="space-y-4">
        {timeEntries.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Clock className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No time entries</h3>
              <p className="text-gray-500 mb-4">
                No time entries found for {format(selectedDate, "MMMM d, yyyy")}.
              </p>
              {canCreateTimeEntries && (
                <Button onClick={handleCreateNew}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Entry
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          timeEntries.map((entry) => (
            <Card key={entry.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Badge className={getStatusColor(entry.status)}>
                        {getStatusIcon(entry.status)}
                        <span className="ml-1 capitalize">{entry.status}</span>
                      </Badge>
                      <span className="font-medium text-lg">
                        {formatDuration(entry.duration || 0)}
                      </span>
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1">
                      {entry.description || "No description"}
                    </h3>
                    <div className="text-sm text-gray-500 space-y-1">
                      <div>Project: {entry.project?.name || "Unknown"}</div>
                      <div>Task: {entry.task?.name || "No task"}</div>
                      <div>
                        Time: {entry.start_time && format(new Date(entry.start_time), "h:mm a")}
                        {entry.end_time && ` - ${format(new Date(entry.end_time), "h:mm a")}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {canEditTimeEntries && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(entry)}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                    )}
                    {canDeleteTimeEntries && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(entry.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Time Entry Modal */}
      <EnhancedTimeEntryModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingEntry(null);
        }}
        onSuccess={() => {
          refetch();
          setIsModalOpen(false);
          setEditingEntry(null);
        }}
        editingEntry={editingEntry}
        defaultDate={selectedDate}
      />
    </PageLayout>
  );
}