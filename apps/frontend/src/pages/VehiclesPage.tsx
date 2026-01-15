import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";

// Placeholder for VehiclesPage - to be implemented with full vehicle listing
export const VehiclesPage = () => {
    return (
        <div className="min-h-screen flex flex-col bg-white">
            <Navbar />
            <main className="flex-1 container mx-auto px-4 lg:px-8 py-12">
                <h1 className="text-3xl font-bold text-zinc-900 mb-4">Available Vehicles</h1>
                <p className="text-zinc-600">Vehicle listing will be displayed here based on your search criteria.</p>
            </main>
            <Footer />
        </div>
    );
};

export default VehiclesPage;
