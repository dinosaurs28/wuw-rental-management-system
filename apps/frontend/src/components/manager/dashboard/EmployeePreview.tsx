
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Plus } from "lucide-react";
import { type Employee } from "@/services/managerDashboard.service";

interface EmployeePreviewProps {
    employees?: Employee[];
    isLoading?: boolean;
}

export const EmployeePreview = ({ employees = [], isLoading = false }: EmployeePreviewProps) => {

    return (
        <Card className="border shadow-none bg-neutral-50/50">
            <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
                        <Users className="w-4 h-4 text-neutral-500" />
                        Employee Shortcut
                    </span>
                    <Button variant="outline" size="sm" className="h-7 text-xs bg-white" asChild>
                        <Link to="/manager/employees">Manage All</Link>
                    </Button>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    <Link to="/manager/employees/new" className="shrink-0 flex flex-col items-center gap-1 group">
                        <div className="w-10 h-10 rounded-full border-2 border-dashed border-neutral-300 flex items-center justify-center text-neutral-400 group-hover:border-orange-300 group-hover:text-orange-500 bg-white transition-colors">
                            <Plus className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-medium text-neutral-500 group-hover:text-orange-600">Add New</span>
                    </Link>

                    {isLoading ? (
                        Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="w-10 h-10 rounded-full shrink-0" />
                        ))
                    ) : (
                        employees.slice(0, 5).map((employee) => (
                            <Link key={employee.id} to={`/manager/employees/${employee.id}`} className="shrink-0 group" title={employee.name}>
                                <Avatar className="w-10 h-10 border-2 border-white ring-1 ring-neutral-100 group-hover:ring-orange-200 transition-all">
                                    <AvatarFallback className="text-xs bg-neutral-200 text-neutral-600 font-medium group-hover:bg-orange-100 group-hover:text-orange-700">
                                        {employee.name.charAt(0)}
                                    </AvatarFallback>
                                </Avatar>
                            </Link>
                        ))
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
