import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart } from "lucide-react";
import type { Project } from "@shared/schema";

interface ProjectBreakdownItem {
  project: Project;
  totalHours: number;
  percentage: number;
}

interface ProjectBreakdownProps {
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

const CHART_COLORS = [
  { color: '#1976D2', bg: 'bg-primary', border: 'border-primary' },
  { color: '#388E3C', bg: 'bg-green-500', border: 'border-green-500' },
  { color: '#F57C00', bg: 'bg-orange-500', border: 'border-orange-500' },
  { color: '#D32F2F', bg: 'bg-red-500', border: 'border-red-500' },
];

export default function ProjectBreakdown({ dateRange }: ProjectBreakdownProps) {
  const { data: breakdown, isLoading, error } = useQuery<ProjectBreakdownItem[]>({
    queryKey: ["/api/dashboard/project-breakdown", dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      });
      const response = await fetch(`/api/dashboard/project-breakdown?${params}`);
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
    console.error('🔴 [PROJECT-BREAKDOWN] Error loading breakdown:', error);
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <PieChart className="w-5 h-5 mr-2 text-primary" />
            Project Time Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-red-500">
            <p>Unable to load project breakdown</p>
            <p className="text-sm mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <PieChart className="w-5 h-5 mr-2 text-primary" />
            Project Time Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-gray-200 rounded-full mr-3"></div>
                    <div className="h-4 w-32 bg-gray-200 rounded"></div>
                  </div>
                  <div className="h-4 w-16 bg-gray-200 rounded"></div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2"></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!breakdown || breakdown.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <PieChart className="w-5 h-5 mr-2 text-primary" />
            Project Time Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-muted-foreground">No time entries found</p>
            <p className="text-sm text-muted-foreground mt-1">Start logging time to see project breakdown</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const projectData = breakdown?.map((item: any, index: number) => {
    const colors = CHART_COLORS[index % CHART_COLORS.length] || CHART_COLORS[0];
    
    // Safe parsing with proper null checks
    const totalHours = item?.totalHours != null ? Number(item.totalHours) : 0;
    const percentage = item?.percentage != null ? Number(item.percentage) : 0;
    
    return {
      name: item?.project?.name || 'Unknown Project',
      hours: isNaN(totalHours) ? 0 : totalHours,
      percentage: isNaN(percentage) ? 0 : percentage,
      color: colors?.color || '#8884d8',
      bg: colors?.bg || 'bg-blue-500',
      border: colors?.border || 'border-blue-500'
    };
  }) || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <PieChart className="w-5 h-5 mr-2 text-primary" />
          Project Time Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {projectData.map((item, index) => {
            const colors = CHART_COLORS[index % CHART_COLORS.length] || CHART_COLORS[0];
            return (
              <div key={index}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center">
                    <div className={`${colors?.bg || 'bg-blue-500'} w-3 h-3 rounded-full mr-3`}></div>
                    <span className="font-medium text-gray-900">{item.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-gray-900">{item.hours.toFixed(1)}h</span>
                    <span className="text-sm text-gray-500 ml-2">{item.percentage}%</span>
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`${colors?.bg || 'bg-blue-500'} h-2 rounded-full transition-all duration-300`}
                    style={{ width: `${item.percentage}%` }}
                  ></div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}