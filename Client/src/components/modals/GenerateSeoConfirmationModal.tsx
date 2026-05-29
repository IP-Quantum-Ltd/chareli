import { Dialog } from '../ui/dialog';
import { CustomDialogContent } from '../ui/custom-dialog-content';
import { Button } from '../ui/button';
import { AlertTriangle, XIcon } from 'lucide-react';

interface GenerateSeoConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isConfirming?: boolean;
}

export function GenerateSeoConfirmationModal({
  open,
  onOpenChange,
  onConfirm,
  isConfirming = false,
}: GenerateSeoConfirmationModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <CustomDialogContent className="bg-white dark:bg-[#334154] rounded-2xl shadow-lg p-4 sm:p-8 min-w-[320px] max-w-[90vw] w-full sm:w-[440px] border-none font-dmmono tracking-wide">
        <button
          type="button"
          className="absolute -top-4 -right-4 w-10 h-10 rounded-full bg-[#6A7282] flex items-center justify-center shadow-lg hover:bg-[#5A626F] transition-colors z-10"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
        >
          <XIcon className="w-6 h-6 text-white" />
        </button>

        <div className="mb-4 sm:mb-6 flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
          <h2 className="text-lg sm:text-xl tracking-wider font-semibold text-[#0F1621] dark:text-white">
            Generate SEO for this game?
          </h2>
        </div>

        <p className="mb-6 sm:mb-8 text-[#22223B] text-sm sm:text-[16px] tracking-wider dark:text-white">
          Running the SEO agent will incur additional charges on your account.
          Results are delivered as a proposal for review and are not applied to
          this form automatically.
        </p>

        <div className="flex flex-col sm:flex-row sm:justify-end gap-3 sm:gap-4">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto h-10 sm:h-12 text-sm rounded-lg dark:bg-white dark:text-black order-2 sm:order-1 cursor-pointer"
            onClick={() => onOpenChange(false)}
            disabled={isConfirming}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto h-10 sm:h-12 text-sm rounded-lg bg-[#6A7282] hover:bg-[#5A626F] text-white order-1 sm:order-2 cursor-pointer"
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? 'Starting...' : 'Generate SEO'}
          </Button>
        </div>
      </CustomDialogContent>
    </Dialog>
  );
}
