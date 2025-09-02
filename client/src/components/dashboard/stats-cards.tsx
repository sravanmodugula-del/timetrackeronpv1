import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, Calendar, BarChart3, CalendarDays } from "lucide-react";

interface DashboardStats {
  todayHours: number;
  weekHours: number;
  monthHours: number;
  activeProjects: number;
}

interface StatsCardsProps {
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

export default function StatsCards({ dateRange }: StatsCardsProps) {
  const { data: stats, isLoading, error } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats", dateRange],
    queryFn: async () => {
      try {
        const params = new URLSearchParams({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
        });
        const response = await fetch(`/api/dashboard/stats?${params}`);
        
        if (!response.ok) {
          console.error("Dashboard stats API error:", response.status, response.statusText);
          // Return safe defaults instead of throwing
          return {
            todayHours: 0,
            weekHours: 0,
            monthHours: 0,
            activeProjects: 0
          };
        }
        
        const data = await response.json();
        console.log("📊 [STATS-CARDS] Received data:", data);
        
        // Ensure all values are valid numbers
        return {
          todayHours: Number(data.todayHours || 0),
          weekHours: Number(data.weekHours || 0),
          monthHours: Number(data.monthHours || 0),
          activeProjects: Number(data.activeProjects || 0)
        };
      } catch (error) {
        console.error("📊 [STATS-CARDS] Error:", error);
        // Return safe defaults instead of throwing
        return {
          todayHours: 0,
          weekHours: 0,
          monthHours: 0,
          activeProjects: 0
        };
      }
    },
    // Add retry and error handling options
    retry: 2,
    retryDelay: 1000,
  });

  const statCards = [
    {
      title: "Today's Hours",
      value: stats?.todayHours?.toFixed(1) || "0.0",
      icon: Clock,
      color: "text-primary",
      bgColor: "bg-primary bg-opacity-10",
    },
    {
      title: "This Week",
      value: stats?.weekHours?.toFixed(1) || "0.0",
      icon: Calendar,
      color: "text-green-600",
      bgColor: "bg-green-100",
    },
    {
      title: "Active Projects",
      value: stats?.activeProjects?.toString() || "0",
      icon: BarChart3,
      color: "text-orange-600",
      bgColor: "bg-orange-100",
    },
    {
      title: "This Month",
      value: stats?.monthHours?.toFixed(1) || "0.0",
      icon: CalendarDays,
      color: "text-primary",
      bgColor: "bg-primary bg-opacity-10",
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="w-12 h-12 bg-gray-200 rounded-lg"></div>
                <div className="ml-4 space-y-2">
                  <div className="h-4 w-20 bg-gray-200 rounded"></div>
                  <div className="h-8 w-16 bg-gray-200 rounded"></div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {statCards.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <Card key={index} className="stats-card hover:shadow-md transition-shadow duration-200">
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className={`p-3 ${stat.bgColor} rounded-lg`}>
                  <Icon className={`w-6 h-6 ${stat.color}`} />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                  <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}