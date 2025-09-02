import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { History } from "lucide-react";
import type { TimeEntryWithProject } from "@shared/schema";

interface RecentActivityProps {
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

// The local TimeEntryWithProject type declaration has been removed as it conflicts with the imported type.


export default function RecentActivity({ dateRange }: RecentActivityProps) {
  const { data: activities, isLoading, error } = useQuery<TimeEntryWithProject[]>({
    queryKey: ["/api/dashboard/recent-activity", dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        limit: "10",
      });
      const response = await fetch(`/api/dashboard/recent-activity?${params}`);
      if (!response.ok) {
        throw new Error(`${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    retry: 3,
    staleTime: 30000,
  });

  // Handle errors
  if (error) {
    console.error('🔴 [RECENT-ACTIVITY] Error loading activities:', error);
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <History className="w-5 h-5 mr-2 text-primary" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-red-500">
            <p>Unable to load recent activity</p>
            <p className="text-sm mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getProjectColor = () => {
    // Default to primary color since project color is not available in this context
    return 'bg-primary';
  };

  const formatDate = (dateString: string | Date) => {
    try {
      const dateStr = typeof dateString === 'string' ? dateString : dateString.toString();
      const date = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
      
      if (isNaN(date.getTime())) {
        return "Unknown date";
      }
      
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (date.toDateString() === today.toDateString()) {
        return "Today";
      } else if (date.toDateString() === yesterday.toDateString()) {
        return "Yesterday";
      } else {
        const diffTime = Math.abs(today.getTime() - date.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return `${diffDays} days ago`;
      }
    } catch (error) {
      console.error('🔴 [RECENT-ACTIVITY] Date formatting error:', error);
      return "Unknown date";
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <History className="w-5 h-5 mr-2 text-primary" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="animate-pulse flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
                <div className="w-2 h-2 bg-gray-200 rounded-full mt-2"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-gray-200 rounded"></div>
                  <div className="h-3 w-48 bg-gray-200 rounded"></div>
                  <div className="h-3 w-28 bg-gray-200 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <History className="w-5 h-5 mr-2 text-primary" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-muted-foreground">No recent activity</p>
            <p className="text-sm text-muted-foreground mt-1">Start logging time to see recent entries</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <History className="w-5 h-5 mr-2 text-primary" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.map((activity) => (
            <div key={activity.id} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
              <div className={`w-2 h-2 ${getProjectColor()} rounded-full mt-2`}></div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">
                  {activity?.project?.name || activity?.projectName || 'Unknown Project'}
                </p>
                <p className="text-xs text-gray-600">
                  {activity?.description || "No description"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {formatDate(activity?.date || new Date().toISOString())} • {Number(activity?.duration || 0).toFixed(1)} hours
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}