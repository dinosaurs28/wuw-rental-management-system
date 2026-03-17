import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Upload, Loader2, CheckCircle } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import apiClient from "@/lib/axios";

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const ACEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

const uploadKycSchema = z.object({
  type: z.enum(["DL", "AADHAAR", "PAN"], {
    required_error: "Please select document type",
  }),
  file: z
    .instanceof(File, { message: "Please select a file" })
    .refine(
      (file) => file.size <= MAX_FILE_SIZE,
      "File size must be less than 15MB",
    )
    .refine(
      (file) => ACEPTED_IMAGE_TYPES.includes(file.type),
      "Only .jpg, .png, .webp and .pdf files are accepted",
    ),
});

type UploadKycFormValues = z.infer<typeof uploadKycSchema>;

interface UploadKycDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerPublicId: string;
  onSuccess: () => void;
}

export const UploadKycDialog = ({
  open,
  onOpenChange,
  customerPublicId,
  onSuccess,
}: UploadKycDialogProps) => {
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const form = useForm<UploadKycFormValues>({
    resolver: zodResolver(uploadKycSchema),
  });

  const onSubmit = async (data: UploadKycFormValues) => {
    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Simulate progress (since axios upload progress needs config)
      const interval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(interval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      // We need to use a custom upload function for Walk-in because kycService.uploadDocument is for logged-in user
      // We'll make a direct call or add a method to kycService.
      // Let's use direct call here for simplicity or update service.
      // I'll update service to be clean.

      const formData = new FormData();
      formData.append("file", data.file);
      formData.append("kyc_type", data.type);
      formData.append("customer_public_id", customerPublicId);

      await apiClient.post("/employee/walkin/kyc/upload", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      clearInterval(interval);
      setUploadProgress(100);

      toast.success("KYC Document uploaded successfully");
      form.reset();
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Upload error:", error);
      toast.error(error.response?.data?.message || "Failed to upload document");
      setUploadProgress(0);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    fieldChange: (file: File) => void,
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      fieldChange(file);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload KYC Document</DialogTitle>
          <DialogDescription>
            Upload KYC document for the customer.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Document Type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select document type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="DL">Driver's License</SelectItem>
                      <SelectItem value="AADHAAR">Aadhaar Card</SelectItem>
                      <SelectItem value="PAN">PAN Card</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="file"
              render={({ field: { value, onChange, ...fieldProps } }) => (
                <FormItem>
                  <FormLabel>Document File</FormLabel>
                  <FormControl>
                    <div className="grid w-full items-center gap-1.5">
                      <div className="flex items-center justify-center w-full">
                        <label
                          htmlFor="dropzone-file"
                          className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 ${
                            value
                              ? "border-primary bg-primary/5"
                              : "border-gray-300"
                          }`}
                        >
                          <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            {value ? (
                              <>
                                <CheckCircle className="w-8 h-8 mb-2 text-primary" />
                                <p className="mb-2 text-sm text-gray-500 font-medium truncate max-w-[200px]">
                                  {value.name}
                                </p>
                                <p className="text-xs text-gray-400">
                                  {(value.size / 1024 / 1024).toFixed(2)} MB
                                </p>
                              </>
                            ) : (
                              <>
                                <Upload className="w-8 h-8 mb-2 text-gray-500" />
                                <p className="mb-2 text-sm text-gray-500">
                                  <span className="font-semibold">
                                    Click to upload
                                  </span>
                                </p>
                                <p className="text-xs text-gray-500">
                                  JPG, PNG, PDF (MAX. 15MB)
                                </p>
                              </>
                            )}
                          </div>
                          <input
                            id="dropzone-file"
                            type="file"
                            className="hidden"
                            accept={ACEPTED_IMAGE_TYPES.join(",")}
                            onChange={(e) => handleFileChange(e, onChange)}
                            {...fieldProps}
                          />
                        </label>
                      </div>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isUploading && (
              <div className="space-y-2">
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-center text-muted-foreground">
                  Uploading...
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isUploading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isUploading}>
                {isUploading && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Upload
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
