import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Building2,
  Car,
  BarChart3,
  Bell,
  User,
  FileText,
  FileBarChart,
  TrendingUp,
  Shield,
  DollarSign,
  Users,
  Receipt,
  Tag,
  MessageCircle,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAdminAuthStore } from "@/store/adminAuth.store";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const items = [
  {
    title: "Dashboard",
    url: "/admin/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Branches",
    url: "/admin/branches",
    icon: Building2,
  },
  {
    title: "Global Reports",
    url: "/admin/reports",
    icon: BarChart3,
  },
  {
    title: "Discount Rules",
    url: "/admin/discount-rules",
    icon: Tag,
  },
  {
    title: "WhatsApp Support",
    url: "/admin/whatsapp-config",
    icon: MessageCircle,
  },
];

const reportItems = [
  {
    title: "Vehicle Reports",
    url: "/admin/vehicle-reports",
    icon: Car,
  },
  {
    title: "Daily Summary",
    url: "/admin/reports/daily-summary",
    icon: FileBarChart,
  },
  {
    title: "Sales Report",
    url: "/admin/reports/sales",
    icon: TrendingUp,
  },
  {
    title: "Vehicle Availability",
    url: "/admin/reports/vehicle-availability",
    icon: FileText,
  },
  {
    title: "Insurance & Permit",
    url: "/admin/reports/insurance-permit-expiry",
    icon: Shield,
  },
  {
    title: "Collection Report",
    url: "/admin/reports/collection",
    icon: DollarSign,
  },
  {
    title: "Fleet Executive",
    url: "/admin/reports/fleet-executive",
    icon: Users,
  },
  {
    title: "GST Report",
    url: "/admin/reports/gst",
    icon: Receipt,
  },
];

export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAdminAuthStore();

  const handleLogout = () => {
    logout();
    navigate("/admin/sign-in");
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarContent>
          <div className="p-4 flex items-center gap-2 font-bold text-xl text-primary">
            <Car className="h-6 w-6" />
            <span className="group-data-[collapsible=icon]:hidden">
              WUW Rental Admin
            </span>
          </div>
          <SidebarGroup>
            <SidebarGroupLabel>Menu</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === item.url}
                      tooltip={item.title}
                      onClick={() => navigate(item.url)}
                    >
                      <button>
                        <item.icon />
                        <span>{item.title}</span>
                      </button>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Detailed Reports</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {reportItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === item.url}
                      tooltip={item.title}
                      onClick={() => navigate(item.url)}
                    >
                      <button>
                        <item.icon />
                        <span>{item.title}</span>
                      </button>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 bg-background">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon">
              <Bell className="h-5 w-5 text-muted-foreground" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-8 w-8 rounded-full"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src="" />
                    <AvatarFallback>AD</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {user?.name || "Admin"}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user?.email || "admin@example.com"}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/admin/dashboard")}>
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 overflow-auto bg-muted/10 p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
