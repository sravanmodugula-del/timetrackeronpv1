import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { History } from "lucide-react";
import type { TimeEntryWithProject } from "@shared/schema";
import { Clock } from "lucide-react";
import { formatPSTDate } from "@shared/timezone";

interface RecentActivityProps {
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

// The local TimeEntryWithProject type declaration has been removed as it conflicts with the imported type.


export default function RecentActivity({ dateRange }: RecentActivityProps) {
  const { data: activities, isLoading } = useQuery<TimeEntryWithProject[]>({
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
  });

  const getProjectColor = () => {
    // Default to primary color since project color is not available in this context
    return 'bg-primary';
  };

  const formatDate = (dateString: string | Date) => {
    try {
      // Get today's date in PST
      const now = new Date();
      const todayPST = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      
      // Extract date part from the input
      let entryDateStr: string;
      if (typeof dateString === 'string') {
        // If it's already in YYYY-MM-DD format, use it directly
        if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
          entryDateStr = dateString;
        } else {
          // Otherwise try to extract date part
          const dateObj = new Date(dateString);
          if (!isNaN(dateObj.getTime())) {
            entryDateStr = dateObj.toISOString().split('T')[0];
          } else {
            console.warn('Invalid date in recent activity:', dateString);
            return "Unknown date";
          }
        }
      } else {
        const dateObj = new Date(dateString);
        if (!isNaN(dateObj.getTime())) {
          entryDateStr = dateObj.toISOString().split('T')[0];
        } else {
          console.warn('Invalid date in recent activity:', dateString);
          return "Unknown date";
        }
      }

      // Calculate yesterday's date in PST
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayPST = yesterday.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

      if (entryDateStr === todayPST) {
        return "Today";
      } else if (entryDateStr === yesterdayPST) {
        return "Yesterday";
      } else {
        // Calculate days difference using PST dates
        const entryDate = new Date(entryDateStr + 'T00:00:00');
        const todayDate = new Date(todayPST + 'T00:00:00');
        const diffTime = Math.abs(todayDate.getTime() - entryDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
      }
    } catch (error) {
      console.error('Error formatting date in recent activity:', error, dateString);
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

  // Filter out invalid activities and provide safe defaults
  const safeActivities = (activities || []).filter(activity => 
    activity && typeof activity === 'object'
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <Clock className="w-5 h-5 mr-2" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {safeActivities && safeActivities.length > 0 ? (
          <div className="space-y-4">
            {safeActivities.map((activity, index) => (
              <div key={activity.id} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
                <div className={`w-2 h-2 ${getProjectColor()} rounded-full mt-2`}></div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{activity.project.name}</p>
                  <p className="text-xs text-gray-600">
                    {activity.description || "No description"}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {formatDate(activity.date)} • {typeof activity.duration === 'number' ? activity.duration : (activity.hours || 0)} hours
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No recent activity</p>
            <p className="text-sm text-muted-foreground mt-1">Start logging time to see recent entries</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}