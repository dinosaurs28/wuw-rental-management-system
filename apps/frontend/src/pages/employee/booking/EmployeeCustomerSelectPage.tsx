import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Search, Plus, QrCode, User, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

import { useEmployeeAuthStore } from "@/store/employeeAuth.store";
import { bookingService } from "@/services/booking.service";
import { customerSession, type CustomerSession } from "@/utils/customerSession";
import { QrScannerModal } from "@/components/employee/QrScannerModal";

interface SearchResult {
  publicId: string;
  name: string;
  email: string;
  phone: string;
  customerProfile: {
    isProfileCompleted: boolean;
    publicId: string;
  } | null;
}

export default function EmployeeCustomerSelectPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useEmployeeAuthStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  const [hasActiveSession, setHasActiveSession] = useState(false);

  // Session Warning Dialog
  const [showSessionWarning, setShowSessionWarning] = useState(false);

  // Auth & Session Check
  useEffect(() => {
    if (!isAuthenticated) return;

    const exists = customerSession.exists();
    setHasActiveSession(exists);

    if (exists) {
      setShowSessionWarning(true);
    }
  }, [isAuthenticated]);

  const handleClearSession = () => {
    customerSession.clear();
    setShowSessionWarning(false);
    setHasActiveSession(false);
    toast.info("Previous customer session cleared");
  };

  // Search Logic
  useEffect(() => {
    const timer = setTimeout(async () => {
      // ... existing logic ...
      if (searchQuery.trim().length >= 3) {
        setIsLoading(true);
        try {
          // ... existing logic ...
          const response = await bookingService.searchCustomers(searchQuery);
          setResults(response.customers || []);
        } catch (error) {
          console.error(error);
        } finally {
          setIsLoading(false);
        }
      } else {
        setResults([]);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectCustomer = (customer: SearchResult) => {
    const session: CustomerSession = {
      publicId: customer.publicId,
      name: customer.name,
      phone: customer.phone,
      profileCompleted: customer.customerProfile?.isProfileCompleted || false,
      kycStatus: false,
    };

    customerSession.set(session);
    setHasActiveSession(true);
    toast.success(`Selected customer: ${customer.name}`);
    navigate("/employee/vehicles");
  };

  const handleScan = async (data: string | null) => {
    if (data) {
      setIsScannerOpen(false);
      setSearchQuery(data);
      toast.info(`Scanned Code: ${data}`);
    }
  };

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-gray-50/50 pb-20">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="container max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/employee/dashboard")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">Select Customer</h1>
            <p className="text-xs text-muted-foreground">New Booking</p>
          </div>
          {hasActiveSession && (
            <Button
              variant="destructive"
              size="sm"
              className="ml-auto"
              onClick={() => setShowSessionWarning(true)}
            >
              Clear Session
            </Button>
          )}
        </div>
      </div>

      <div className="container max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Search & Actions */}
        <Card className="border-0 shadow-sm bg-white">
          <CardContent className="p-4 space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by Name, Phone, or Public ID..."
                  className="pl-9 bg-gray-50"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setIsScannerOpen(true)}
              >
                <QrCode className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex justify-between items-center pt-2">
              <span className="text-xs text-muted-foreground">
                Or create a new account
              </span>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => navigate("/employee/customer/create")}
              >
                <Plus className="mr-2 h-4 w-4" /> Create New Customer
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results List */}
        <div className="space-y-3">
          {searchQuery.length < 3 && !isLoading && (
            <div className="text-center py-12 text-muted-foreground">
              <User className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>Enter at least 3 characters to search</p>
            </div>
          )}

          {isLoading && (
            <div className="py-12 text-center text-muted-foreground">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
              <p>Searching...</p>
            </div>
          )}

          <AnimatePresence>
            {results.map((customer) => (
              <motion.div
                key={customer.publicId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <Card className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow">
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-semibold">
                        {customer.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">
                          {customer.name}
                        </h3>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span>{customer.phone}</span>
                          <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-500 font-mono">
                            {customer.publicId.slice(-6)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button onClick={() => handleSelectCustomer(customer)}>
                      Select User
                    </Button>
                  </div>
                  {!customer.customerProfile?.isProfileCompleted && (
                    <div className="bg-yellow-50 px-4 py-2 text-xs flex items-center gap-2 text-yellow-700">
                      <AlertCircle className="h-3 w-3" />
                      Profile incomplete. You will need to complete it later.
                    </div>
                  )}
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>

          {searchQuery.length >= 3 && !isLoading && results.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No customers found.</p>
              <Button
                variant="link"
                onClick={() => navigate("/employee/customer/create")}
              >
                Create new customer instead?
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Session Warning Dialog */}
      <Dialog open={showSessionWarning} onOpenChange={setShowSessionWarning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Active Session Found</DialogTitle>
            <DialogDescription>
              A customer booking session is already in progress. Do you want to
              continue with the existing session or start over?
            </DialogDescription>
          </DialogHeader>
          <div className="bg-gray-50 p-3 rounded-md text-sm mb-2">
            <span className="font-medium">Current Session:</span> <br />
            Customer: {customerSession.get()?.name || "Unknown"} <br />
            Phone: {customerSession.get()?.phone || "Unknown"}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="destructive" onClick={handleClearSession}>
              Clear & Start New
            </Button>
            <Button
              variant="default"
              onClick={() => navigate("/employee/vehicles")}
            >
              Continue Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QrScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleScan}
      />
    </div>
  );
}

// Missing icon import hack (assuming lucide-react has ArrowLeft, if not, I'll switch to ChevronLeft)
import { ArrowLeft } from "lucide-react";
