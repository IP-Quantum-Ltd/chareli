import { Dialog } from "../ui/dialog";
import { CustomDialogContent } from "../ui/custom-dialog-content";
import { Button } from "../ui/button";
import { XIcon } from "lucide-react";

interface DeleteConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isDeleting?: boolean;
  title?: string;
  description?: string | React.ReactNode;
  confirmButtonText?: string;
  loadingText?: string;
}

export function DeleteConfirmationModal({
  open,
  onOpenChange,
  onConfirm,
  isDeleting = false,
  title = "Are you sure you want to delete?",
  description = "This action cannot be reversed",
  confirmButtonText = "Delete",
  loadingText = "Deleting...",
}: DeleteConfirmationModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <CustomDialogContent
        className="bg-white dark:bg-[#334154] rounded-2xl shadow-lg p-4 sm:p-8 min-w-[320px] max-w-[90vw] w-full sm:w-[440px] border-none font-dmmono tracking-wide"
      >
        {/* Custom Close Button */}
        <button
          className="absolute -top-4 -right-4 w-10 h-10 rounded-full bg-[#6A7282] flex items-center justify-center shadow-lg hover:bg-[#5A626F] transition-colors z-10"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
        >
          <XIcon className="w-6 h-6 text-white" />
        </button>

        {/* Title */}
        <div className="mb-4 sm:mb-6">
          <h2 className="text-lg sm:text-xl tracking-wider font-semibold text-[#0F1621] dark:text-white">
            {title}
          </h2>
        </div>

        {/* Description */}
        <div className="mb-6 sm:mb-8 text-[#22223B] text-sm sm:text-[16px] tracking-wider dark:text-white break-all overflow-wrap-anywhere">
          {description}
        </div>

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row sm:justify-end gap-3 sm:gap-4">
          <Button
            variant="outline"
            className="w-full sm:w-auto h-10 sm:h-12 text-sm rounded-lg dark:bg-white dark:text-black order-2 sm:order-1 cursor-pointer"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="w-full sm:w-auto h-10 sm:h-12 text-sm rounded-lg dark:bg-[#EF4444] order-1 sm:order-2 cursor-pointer"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? loadingText : confirmButtonText}
          </Button>
        </div>
      </CustomDialogContent>
    </Dialog>
  );
}
