import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Car } from 'lucide-react';

export const EmptyBookingState = () => {
    const navigate = useNavigate();

    return (
        <Card className="bg-white border border-zinc-200 rounded-xl shadow-sm">
            <CardContent className="flex flex-col items-center justify-center py-16 px-6 text-center">
                {/* Icon */}
                <div className="w-20 h-20 rounded-full bg-zinc-100 flex items-center justify-center mb-6">
                    <Car className="size-10 text-zinc-400" />
                </div>

                {/* Title */}
                <h2 className="text-xl font-semibold text-foreground mb-2">
                    No Vehicle Selected
                </h2>

                {/* Description */}
                <p className="text-sm text-muted-foreground max-w-sm mb-6">
                    You haven't selected a vehicle for booking yet. Browse our fleet to find the perfect ride for your journey.
                </p>

                {/* CTA */}
                <Button
                    onClick={() => navigate('/vehicles')}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6"
                >
                    Browse Vehicles
                </Button>
            </CardContent>
        </Card>
    );
};
