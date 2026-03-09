/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import type { FormikHelpers } from "formik";
import type { LoginCredentials } from "../../backend/types";
import { object as yupObject, string as yupString } from "yup";
import { passwordSchema } from "../../validation/password";
import { useAuth } from "../../context/AuthContext";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { AiOutlineMail } from "react-icons/ai";
import { OTPVerificationModal } from "../../components/modals/OTPVerificationModal";
import { ForgotPasswordModal } from "../../components/modals/ForgotPasswordModal";
import Logo from "../../assets/logo.svg";
import { usePermissions } from "../../hooks/usePermissions";

interface LoginFormValues {
  email: string;
  password: string;
}

interface LoginResponse {
  success?: boolean;
  userId: string;
  hasEmail: boolean;
  hasPhone: boolean;
  phoneNumber?: string;
  email?: string;
  requiresOtp: boolean;
  role: string;
  otpType?: "EMAIL" | "SMS" | "NONE";
  message: string;
  tokens?: {
    accessToken: string;
    refreshToken: string;
  };
  debug?: {
    error: string;
    type: string;
    timestamp: string;
  };
}

const validationSchema = yupObject({
  email: yupString()
    .email("Invalid email address")
    .required("Email is required"),
  password: passwordSchema,
});

export default function AdminLogin() {
  const [showPassword, setShowPassword] = useState(false);
  const [loginResponse, setLoginResponse] = useState<LoginResponse | null>(
    null
  );
  const [isOTPModalOpen, setIsOTPModalOpen] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isForgotPasswordModalOpen, setIsForgotPasswordModalOpen] =
    useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const { login, isAuthenticated, isLoading } = useAuth();
  const { hasAdminAccess } = usePermissions();
  const navigate = useNavigate();

  // If already authenticated as admin, redirect to admin dashboard
  useEffect(() => {
    if (!isLoading && isAuthenticated && hasAdminAccess) {
      navigate("/admin", { replace: true });
    }
  }, [isAuthenticated, isLoading, hasAdminAccess, navigate]);

  const handleLogin = async (
    values: LoginFormValues,
    actions: FormikHelpers<LoginFormValues>
  ) => {
    try {
      setLoginError("");
      setIsLoggingIn(true);
      const credentials: LoginCredentials = {
        identifier: values.email,
        password: values.password,
      };

      const response: LoginResponse = await login(credentials);
      setLoginResponse(response);

      // Check if login failed due to configuration or service issues
      if (response.success === false) {
        setLoginError(response.message);
        toast.error(response.message);
        if (response.debug && process.env.NODE_ENV !== "production") {
          console.error("Login Debug Info:", response.debug);
        }
        setIsLoggingIn(false);
        return;
      }

      if (response.requiresOtp) {
        setIsOTPModalOpen(true);
        toast.info(response.message);
        setIsLoggingIn(false);
      } else {
        toast.success(response.message);
        navigate("/admin", { replace: true });
        setIsLoggingIn(false);
      }
    } catch (error: any) {
      setIsLoggingIn(false);
      if (error.response?.data?.message) {
        setLoginError(error.response.data.message);
        toast.error(error.response.data.message);
      } else {
        const errorMsg = "Invalid email or password. Please try again.";
        setLoginError(errorMsg);
        toast.error(errorMsg);
      }
    } finally {
      actions.setSubmitting(false);
    }
  };

  // Show loading spinner while checking auth state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0f1221]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#E328AF]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f1221] via-[#1a1f35] to-[#0f1221] flex items-center justify-center p-4">
      <div className="w-full max-w-[420px]">
        {/* Logo & Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-3 mb-4">
            <img src={Logo} alt="Arcades Box" className="w-10 h-10" />
            <span className="text-2xl text-white font-bold font-jersey">
              Arcades Box
            </span>
          </div>
          <h1 className="text-xl font-semibold text-white font-dmmono">
            Admin Login
          </h1>
          <p className="text-sm text-gray-400 mt-1 font-dmmono">
            Sign in to access the admin dashboard
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-[#1e2340] border border-[#2a2f4a] rounded-2xl p-6 shadow-2xl">
          <Formik
            initialValues={{ email: "", password: "" }}
            validationSchema={validationSchema}
            onSubmit={handleLogin}
            validateOnChange={true}
            validateOnBlur={true}
          >
            {({ isSubmitting, isValid }) => (
              <Form className="space-y-5">
                {/* Email Field */}
                <div className="space-y-1">
                  <Label
                    htmlFor="email"
                    className="font-dmmono text-sm text-gray-300"
                  >
                    Email
                  </Label>
                  <div className="relative">
                    <AiOutlineMail
                      size={15}
                      className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 z-10"
                    />
                    <Field
                      as={Input}
                      id="email"
                      name="email"
                      type="email"
                      placeholder="Enter your email"
                      className="bg-[#2a2f4a] border border-[#3a3f5a] text-white pl-10 font-dmmono text-sm tracking-wider h-[48px] rounded-lg focus:border-[#E328AF] focus:ring-1 focus:ring-[#E328AF] transition-colors placeholder:text-gray-500"
                    />
                  </div>
                  <ErrorMessage
                    name="email"
                    component="div"
                    className="text-red-400 mt-1 font-dmmono text-xs tracking-wider"
                  />
                </div>

                {/* Password Field */}
                <div className="space-y-1">
                  <Label
                    htmlFor="password"
                    className="font-dmmono text-sm text-gray-300"
                  >
                    Password
                  </Label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 z-10 hover:text-gray-300 transition-colors"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? (
                        <FaEyeSlash size={15} />
                      ) : (
                        <FaEye size={15} />
                      )}
                    </button>
                    <Field
                      as={Input}
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      className="bg-[#2a2f4a] border border-[#3a3f5a] text-white pl-10 font-dmmono text-sm tracking-wider h-[48px] rounded-lg focus:border-[#E328AF] focus:ring-1 focus:ring-[#E328AF] transition-colors placeholder:text-gray-500"
                    />
                  </div>
                  <ErrorMessage
                    name="password"
                    component="div"
                    className="text-red-400 mt-1 font-dmmono text-xs tracking-wider"
                  />
                  <p className="text-xs text-gray-500 mt-1 font-dmmono">
                    Password must be at least 6 characters with uppercase,
                    letters and numbers
                  </p>
                </div>

                {/* Error Display */}
                {loginError && (
                  <div className="text-red-400 font-dmmono text-sm tracking-wider text-center bg-red-500/10 border border-red-500/20 rounded-lg py-2 px-3">
                    {loginError}
                  </div>
                )}

                {/* Forgot Password */}
                <div className="text-right">
                  <span
                    className="text-gray-400 cursor-pointer font-dmmono text-sm hover:text-white transition-colors"
                    onClick={() => setIsForgotPasswordModalOpen(true)}
                  >
                    Forgot Password?
                  </span>
                </div>

                {/* Submit Button */}
                <Button
                  type="submit"
                  disabled={isSubmitting || !isValid || isLoggingIn}
                  className="w-full bg-gradient-to-r from-[#E328AF] to-[#6A3DE8] hover:from-[#d11f9e] hover:to-[#5a2fd0] text-white font-dmmono h-[48px] rounded-lg transition-all duration-300 transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 cursor-pointer"
                >
                  {isLoggingIn ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></span>
                      Signing in...
                    </span>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </Form>
            )}
          </Formik>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-xs mt-6 font-dmmono">
          This portal is for authorized administrators only.
        </p>
      </div>

      {/* OTP Modal */}
      <OTPVerificationModal
        open={isOTPModalOpen}
        onOpenChange={setIsOTPModalOpen}
        userId={loginResponse?.userId || ""}
        contactMethod={
          loginResponse?.otpType === "EMAIL"
            ? loginResponse?.email || "your registered email"
            : loginResponse?.otpType === "SMS"
            ? loginResponse?.phoneNumber || "your registered phone number"
            : "your registered contact method"
        }
        otpType={loginResponse?.otpType}
      />

      {/* Forgot Password Modal */}
      <ForgotPasswordModal
        open={isForgotPasswordModalOpen}
        onOpenChange={setIsForgotPasswordModalOpen}
        openLoginModal={() => {
          setIsForgotPasswordModalOpen(false);
        }}
      />
    </div>
  );
}
