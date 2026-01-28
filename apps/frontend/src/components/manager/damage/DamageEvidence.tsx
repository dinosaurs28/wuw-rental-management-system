import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { Image as ImageIcon, Maximize2 } from 'lucide-react';
import { AspectRatio } from '@/components/ui/aspect-ratio';

interface DamageEvidenceProps {
    images: { url: string }[];
    damageDetails: Record<string, any>;
    vehicleType?: string;
}

export const DamageEvidence: React.FC<DamageEvidenceProps> = ({ images }) => {
    const [open, setOpen] = useState(false);

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                    <ImageIcon className="w-5 h-5" />
                    Damage Evidence
                </CardTitle>
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-2">
                            <Maximize2 className="w-4 h-4" />
                            View All Images
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl w-full p-0 bg-black/90 border-none sm:rounded-none md:rounded-lg overflow-hidden">
                        <div className="relative w-full h-[80vh] flex items-center justify-center">
                            {images.length > 0 ? (
                                <Carousel className="w-full max-w-3xl">
                                    <CarouselContent>
                                        {images.map((img, idx) => (
                                            <CarouselItem key={idx} className="flex items-center justify-center h-full">
                                                <div className="relative w-full h-full flex items-center justify-center p-4">
                                                    <img
                                                        src={img.url}
                                                        alt={`Damage Evidence ${idx + 1}`}
                                                        className="max-h-[70vh] w-auto max-w-full object-contain rounded-md"
                                                    />
                                                </div>
                                            </CarouselItem>
                                        ))}
                                    </CarouselContent>
                                    <CarouselPrevious className="left-4 bg-white/10 hover:bg-white/20 text-white border-none" />
                                    <CarouselNext className="right-4 bg-white/10 hover:bg-white/20 text-white border-none" />
                                </Carousel>
                            ) : (
                                <div className="text-white text-center">No images available</div>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent className="flex-1">
                {images.length > 0 ? (
                    <div className="grid grid-cols-2 gap-4">
                        {images.slice(0, 4).map((img, idx) => (
                            <div
                                key={idx}
                                className="relative group cursor-pointer overflow-hidden rounded-md border bg-muted"
                                onClick={() => setOpen(true)}
                            >
                                <AspectRatio ratio={4 / 3}>
                                    <img
                                        src={img.url}
                                        alt={`Preview ${idx + 1}`}
                                        className="object-cover w-full h-full transition-transform duration-300 group-hover:scale-105"
                                    />
                                    {idx === 3 && images.length > 4 && (
                                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                            <span className="text-white font-bold text-lg">+{images.length - 4}</span>
                                        </div>
                                    )}
                                </AspectRatio>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-48 bg-muted/30 rounded-lg border-2 border-dashed border-muted text-muted-foreground gap-2">
                        <ImageIcon className="w-8 h-8 opacity-50" />
                        <span className="text-sm">No evidence photos provided</span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
