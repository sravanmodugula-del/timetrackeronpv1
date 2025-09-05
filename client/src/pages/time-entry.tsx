import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import Header from "@/components/layout/header";
import PageLayout from "@/components/layout/page-layout";
import TimeEntryForm from "@/components/time/time-entry-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Square, Clock, Edit2, Trash2 } from "lucide-react";
import type { TimeEntry, Project, Task } from "@shared/schema";

export default function TimeEntryPage() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const [activeTimer, setActiveTimer] = useState<TimeEntry | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);

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

  // Fetch active time entries
  const { data: activeEntries = [], refetch } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries/active"],
    enabled: isAuthenticated,
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Timer effect
  useEffect(() => {
    if (activeTimer) {
      const interval = setInterval(() => {
        const now = new Date();
        const start = new Date(activeTimer.start_time || activeTimer.created_at);
        const diff = Math.floor((now.getTime() - start.getTime()) / 1000);
        setTimerSeconds(diff);
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [activeTimer]);

  // Set active timer from active entries
  useEffect(() => {
    if (activeEntries.length > 0) {
      const timer = activeEntries.find(entry => entry.status === 'running');
      setActiveTimer(timer || null);
    } else {
      setActiveTimer(null);
    }
  }, [activeEntries]);

  // Stop timer mutation
  const stopTimer = useMutation({
    mutationFn: async (entryId: string) => {
      await apiRequest(`/api/time-entries/${entryId}/stop`, "POST");
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Timer stopped successfully",
      });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
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
        description: "Failed to stop timer",
        variant: "destructive",
      });
    },
  });

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStopTimer = (entryId: string) => {
    stopTimer.mutate(entryId);
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
      title="Time Entry"
      subtitle="Track your time and manage active timers"
    >
      {/* Active Timer Display */}
      {activeTimer && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Active Timer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="text-3xl font-mono text-primary">
                  {formatTime(timerSeconds)}
                </div>
                <div>
                  <p className="font-medium">{activeTimer.description || "No description"}</p>
                  <p className="text-sm text-muted-foreground">
                    Started: {new Date(activeTimer.start_time || activeTimer.created_at).toLocaleTimeString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="bg-green-100 text-green-700">
                  <Play className="w-3 h-3 mr-1" />
                  Running
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleStopTimer(activeTimer.id)}
                  disabled={stopTimer.isPending}
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Time Entry Form */}
      <Card>
        <CardHeader>
          <CardTitle>Start New Timer</CardTitle>
        </CardHeader>
        <CardContent>
          <TimeEntryForm
            onSuccess={() => {
              refetch();
              queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
            }}
          />
        </CardContent>
      </Card>
    </PageLayout>
  );
}