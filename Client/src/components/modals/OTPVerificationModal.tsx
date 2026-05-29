/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import OTPInput from "react-otp-input";
import { useAuth } from "../../context/AuthContext";
import { useRequestOtp } from "../../backend/auth.service";
import { toast } from "sonner";
import { isValidRole } from "../../utils/main";

interface OTPVerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  contactMethod?: string; // Email or phone number that received the OTP
  otpType?: "EMAIL" | "SMS" | "NONE"; // Type of OTP sent
  onVerificationSuccess?: () => void; // Callback for when verification is successful
}

export function OTPVerificationModal({
  open,
  onOpenChange,
  userId,
  contactMethod = "your email or phone",
  otpType = "EMAIL",
  onVerificationSuccess,
}: OTPVerificationDialogProps) {
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(30);
  const [canResend, setCanResend] = useState(false);
  const { verifyOtp } = useAuth();
  const requestOtp = useRequestOtp();
  const navigate = useNavigate();

  // Clear error message when modal opens and start cooldown
  useEffect(() => {
    if (open) {
      setError("");
      setOtp("");
      // Start with 30-second cooldown when modal opens
      setResendCooldown(30);
      setCanResend(false);
    }
  }, [open]);

  // Countdown timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (open && resendCooldown > 0) {
      interval = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            setCanResend(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [open, resendCooldown]);

  const handleVerify = async () => {
    if (otp.length !== 6) {
      setError("Please enter a valid 6-digit OTP");
      toast.error("Please enter a valid 6-digit OTP");
      return;
    }

    try {
      setError("");
      setIsVerifying(true);
      const user = await verifyOtp(userId, otp);
      onOpenChange(false);

      // Call the success callback if provided
      if (onVerificationSuccess) {
        onVerificationSuccess();
      }

      const userRole = user?.role?.name;

      setTimeout(() => {
        if (isValidRole(userRole)) {
          navigate("/admin");
        } else {
          navigate("/");
        }
      }, 300);

      toast.success("Login successful! Redirecting...");

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      setError("Invalid OTP. Please try again.");
    } finally {
      setOtp("");
      setIsVerifying(false);
    }
  };

  const handleResendOtp = async () => {
    if (!canResend) return; // Prevent spam clicking

    try {
      setError("");
      await requestOtp.mutateAsync({ userId, otpType });

      // Start new cooldown after successful resend
      setResendCooldown(30);
      setCanResend(false);

      // Show success message
      setError("OTP resent successfully!");
      toast.success("OTP resent successfully!");
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      setError("Failed to resend OTP. Please try again.");
      toast.error("Failed to resend OTP. Please try again.");
    }
  };

  // Reset OTP when modal closes
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setOtp(""); // Clear OTP when modal closes
    }
    onOpenChange(isOpen);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-[90vw] sm:max-w-[425px] p-4 sm:p-6 dark:bg-[#0F1221] rounded-xl">
        {/* Custom Close Button */}
        <button
          className="absolute -top-4 -right-4 w-10 h-10 rounded-full bg-[#6A7282] flex items-center justify-center shadow-lg hover:bg-[#5A626F] transition-colors"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
          style={{ border: "none" }}
        >
          <span className="text-white text-2xl font-bold">×</span>
        </button>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl sm:text-2xl font-bold text-[#6A7282] dark:text-white font-dmmono">
            OTP Verification
          </AlertDialogTitle>
          <AlertDialogDescription className="dark:text-white text-black font-dmmono text-md tracking-wider sm:text-sm mt-1">
            Enter the verification code we just sent to {contactMethod}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex justify-center my-4 sm:my-6">
          <OTPInput
            value={otp}
            onChange={setOtp}
            numInputs={6}
            renderInput={(props) => (
              <div className="px-3 sm:px-3 py-2 sm:py-3 border-2 border-[#6A7282] mx-0.5 sm:mx-1 rounded-lg">
                <input
                  {...props}
                  className="w-12 h-10 sm:w-10 sm:h-10 text-center bg-transparent rounded-none dark:text-white text-black font-worksans text-xl sm:text-2xl font-bold focus:outline-none focus:ring-0"
                />
              </div>
            )}
            inputType="tel"
            shouldAutoFocus
            placeholder=""
          />
        </div>
        {error && (
          <div
            className={`text-xs sm:text-sm text-center font-worksans mt-2 sm:mt-3 ${
              error.includes("resent") ? "text-green-500" : "text-red-500"
            }`}
          >
            {error}
          </div>
        )}
        <Button
          onClick={handleVerify}
          disabled={isVerifying || otp.length !== 6}
          className="w-full bg-[#6A7282] hover:bg-[#5A626F] text-white font-dmmono text-base sm:text-lg py-2 sm:py-3 mt-4 sm:mt-6 cursor-pointer"
        >
          {isVerifying ? "Verifying..." : "Verify"}
        </Button>
        <p className="text-xs sm:text-sm text-center text-black dark:text-white font-dmmono mt-2 sm:mt-3">
          Didn't receive a code?{" "}
          <button
            onClick={handleResendOtp}
            disabled={!canResend || requestOtp.isPending}
            className={`underline text-lg transition-colors ${
              canResend && !requestOtp.isPending
                ? "text-[#6A7282] cursor-pointer hover:text-[#5A626F]"
                : "text-gray-400 cursor-not-allowed"
            }`}
          >
            {requestOtp.isPending
              ? "Sending..."
              : canResend
              ? "Resend"
              : `Resend in ${resendCooldown}s`}
          </button>
        </p>
      </AlertDialogContent>
    </AlertDialog>
  );
}
