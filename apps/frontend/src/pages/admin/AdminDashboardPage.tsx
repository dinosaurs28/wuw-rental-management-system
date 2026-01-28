import { useAdminAuthStore } from '@/store/adminAuth.store';
import { Button } from '@/components/ui/button';

export const AdminDashboardPage = () => {
    const { user, logout } = useAdminAuthStore();

    return (
        <div className="p-8">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">Admin Dashboard</h1>
                <div className="flex items-center gap-4">
                    <span>Welcome, {user?.name}</span>
                    <Button onClick={logout} variant="outline">Logout</Button>
                </div>
            </div>
            <div className="grid gap-4">
                <div className="p-6 border rounded-lg bg-card text-card-foreground shadow-sm">
                    <h3 className="text-lg font-medium">Overview</h3>
                    <p className="text-muted-foreground mt-2">Welcome to the administration panel.</p>
                </div>
            </div>
        </div>
    );
};
