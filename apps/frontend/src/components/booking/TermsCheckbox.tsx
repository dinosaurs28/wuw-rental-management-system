import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TermsCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

type ModalType = "terms" | "privacy" | null;

const TERMS_CONTENT = (
  <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
    <p>
      By proceeding with this booking, you agree to comply with and be bound by
      the following terms and conditions governing use of our vehicle rental
      services.
    </p>
    <h3 className="font-semibold text-foreground">1. Rental Agreement</h3>
    <p>
      The renter must be at least 21 years of age and hold a valid driver's
      license. The vehicle must only be operated by the designated driver(s)
      listed in the booking.
    </p>
    <h3 className="font-semibold text-foreground">2. Vehicle Usage</h3>
    <p>
      Vehicles must not be used for illegal purposes, off-road driving, or
      transporting hazardous materials. Smoking is strictly prohibited inside all
      vehicles.
    </p>
    <h3 className="font-semibold text-foreground">3. Fuel Policy</h3>
    <p>
      Vehicles are provided with a full tank and must be returned with a full
      tank. Failure to do so will result in a fuel surcharge.
    </p>
    <h3 className="font-semibold text-foreground">4. Damage & Liability</h3>
    <p>
      The renter is liable for any damage to the vehicle during the rental
      period. All damages must be reported immediately. An excess fee may apply
      depending on the type of damage.
    </p>
    <h3 className="font-semibold text-foreground">5. Cancellation Policy</h3>
    <p>
      Cancellations made 48 hours or more before the rental start time may be
      eligible for a full refund. Cancellations within 48 hours are
      non-refundable.
    </p>
    <h3 className="font-semibold text-foreground">6. Late Returns</h3>
    <p>
      Late returns will be charged at the standard daily rate pro-rated to the
      number of hours the vehicle is returned late.
    </p>
    <h3 className="font-semibold text-foreground">7. Governing Law</h3>
    <p>
      These terms are governed by the applicable laws of the jurisdiction in
      which the rental takes place.
    </p>
  </div>
);

const PRIVACY_CONTENT = (
  <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
    <p>
      We are committed to protecting your personal information and your right to
      privacy. This policy explains how we collect, use, and safeguard your data.
    </p>
    <h3 className="font-semibold text-foreground">1. Information We Collect</h3>
    <p>
      We collect personal information such as your name, email address, phone
      number, driver's license details, and payment information when you make a
      booking.
    </p>
    <h3 className="font-semibold text-foreground">2. How We Use Your Information</h3>
    <p>
      Your information is used to process bookings, verify your identity, communicate
      with you about your rental, and improve our services.
    </p>
    <h3 className="font-semibold text-foreground">3. Data Sharing</h3>
    <p>
      We do not sell your personal data. We may share information with trusted
      third-party service providers (payment processors, insurance providers)
      solely to fulfil your booking.
    </p>
    <h3 className="font-semibold text-foreground">4. Data Retention</h3>
    <p>
      We retain your personal data for as long as necessary to provide our
      services and comply with legal obligations.
    </p>
    <h3 className="font-semibold text-foreground">5. Your Rights</h3>
    <p>
      You have the right to access, correct, or delete your personal data at any
      time by contacting our support team.
    </p>
    <h3 className="font-semibold text-foreground">6. Cookies</h3>
    <p>
      We use cookies to enhance your browsing experience. You may disable cookies
      through your browser settings, though some features may not function
      correctly.
    </p>
    <h3 className="font-semibold text-foreground">7. Security</h3>
    <p>
      We implement industry-standard security measures to protect your data from
      unauthorised access, disclosure, or loss.
    </p>
  </div>
);

export const TermsCheckbox = ({
  checked,
  onCheckedChange,
  className,
}: TermsCheckboxProps) => {
  const [openModal, setOpenModal] = useState<ModalType>(null);

  return (
    <>
      <div className={cn("flex items-start gap-3", className)}>
        <Checkbox
          id="terms"
          checked={checked}
          onCheckedChange={(val) => onCheckedChange(val === true)}
          className="mt-0.5"
        />
        <label
          htmlFor="terms"
          className="text-sm text-muted-foreground cursor-pointer leading-relaxed"
        >
          I accept the{" "}
          <button
            type="button"
            onClick={() => setOpenModal("terms")}
            className="text-primary hover:underline font-medium"
          >
            General Terms &amp; Conditions
          </button>
          , Rental Information and{" "}
          <button
            type="button"
            onClick={() => setOpenModal("privacy")}
            className="text-primary hover:underline font-medium"
          >
            Privacy Policy
          </button>
          .
        </label>
      </div>

      <Dialog open={openModal !== null} onOpenChange={(open) => !open && setOpenModal(null)}>
        <DialogContent className="max-h-[85vh] flex flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {openModal === "terms" ? "General Terms & Conditions" : "Privacy Policy"}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4 -mr-4 overflow-y-auto max-h-[60vh]">
            {openModal === "terms" ? TERMS_CONTENT : PRIVACY_CONTENT}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
};
