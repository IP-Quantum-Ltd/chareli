import { useState } from "react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import type { FieldProps } from "formik";
import { object as yupObject, string as yupString } from "yup";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { useRegisterFromInvitation } from "../../backend/teams.service";
import {
  passwordSchema,
  confirmPasswordSchema,
} from "../../validation/password";
import LazyPhoneInput from "../../components/ui/LazyPhoneInput";
import { trackConversion } from "../../utils/analytics";

import "../../styles/phone-input.css";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { useUserCountry } from "../../hooks/useUserCountry";

interface RegisterFormProps {
  email: string;
  token: string;
  onSuccess: () => void;
}

const validationSchema = yupObject({
  firstName: yupString().trim().required("First name is required"),
  lastName: yupString().trim().required("Last name is required"),
  password: passwordSchema,
  confirmPassword: confirmPasswordSchema,
  phoneNumber: yupString().required("Phone number is required"),
});

interface FormValues {
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
  phoneNumber: string;
}

// Format phone number
const formatPhoneNumber = (value?: string) => (value ? `+${value}` : value);

export function RegisterForm({ email, token, onSuccess }: RegisterFormProps) {
  const { mutate: register, isPending } = useRegisterFromInvitation();
  const { countryCode } = useUserCountry();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const togglePasswordVisibility = () => setShowPassword(!showPassword);
  const toggleConfirmPasswordVisibility = () =>
    setShowConfirmPassword(!showConfirmPassword);

  const initialValues: FormValues = {
    firstName: "",
    lastName: "",
    password: "",
    confirmPassword: "",
    phoneNumber: "",
  };

  const handleSubmit = (values: FormValues) => {
    register(
      {
        token,
        data: {
          ...values,
          email,
        },
      },
      {
        onSuccess: () => {
          // Fire signup conversion: GA4 sign_up via Zaraz + Meta CompleteRegistration.
          trackConversion.signUp('invitation');
          onSuccess();
        },
      }
    );
  };

  return (
    <Formik
      initialValues={initialValues}
      validationSchema={validationSchema}
      onSubmit={handleSubmit}
    >
      {({ isSubmitting }) => (
        <Form className="space-y-6">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              disabled
              className="mt-1 w-full bg-gray-100 dark:bg-[#1F2937]"
            />
          </div>

          <div>
            <Label htmlFor="firstName">First Name</Label>
            <Field
              as={Input}
              id="firstName"
              name="firstName"
              type="text"
              className="mt-1 w-full"
            />
            <ErrorMessage
              name="firstName"
              component="div"
              className="text-red-500 text-sm mt-1"
            />
          </div>

          <div>
            <Label htmlFor="lastName">Last Name</Label>
            <Field
              as={Input}
              id="lastName"
              name="lastName"
              type="text"
              className="mt-1 w-full"
            />
            <ErrorMessage
              name="lastName"
              component="div"
              className="text-red-500 text-sm mt-1"
            />
          </div>

          <div>
            <Label htmlFor="phoneNumber">Phone Number</Label>
            <Field name="phoneNumber">
              {({ field, form }: FieldProps) => (
                <div className="w-full mt-1">
                  <LazyPhoneInput
                    country={countryCode}
                    value={field.value}
                    onChange={(value) =>
                      form.setFieldValue(
                        "phoneNumber",
                        formatPhoneNumber(value)
                      )
                    }
                    inputStyle={{
                      width: "100%",
                      height: "48px",
                      backgroundColor: "#E2E8F0",
                      border: "0",
                      borderRadius: "0.375rem",
                      fontFamily: "Dm Mono, cursive",
                      fontSize: "11px",
                    }}
                    containerClass="dark:bg-[#191c2b] z-[999]"
                    buttonStyle={{
                      backgroundColor: "#E2E8F0",
                      border: "0",
                      borderRadius: "0.375rem 0 0 0.375rem",
                    }}
                    dropdownStyle={{
                      backgroundColor: "#E2E8F0",
                      color: "#000",
                    }}
                    searchStyle={{
                      backgroundColor: "#E2E8F0",
                      color: "#000",
                    }}
                    enableAreaCodeStretch
                    autoFormat
                    enableSearch
                    disableSearchIcon
                    autocompleteSearch
                    countryCodeEditable={false}
                  />
                </div>
              )}
            </Field>
            <ErrorMessage
              name="phoneNumber"
              component="div"
              className="text-red-500 text-sm mt-1"
            />
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <button
                type="button"
                onClick={togglePasswordVisibility}
                className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 z-10"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <FaEyeSlash size={15} /> : <FaEye size={15} />}
              </button>
              <Field
                as={Input}
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                className="mt-1 w-full pl-10"
              />
            </div>
            <ErrorMessage
              name="password"
              component="div"
              className="text-red-500 text-sm mt-1"
            />
          </div>

          <div>
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <div className="relative">
              <button
                type="button"
                onClick={toggleConfirmPasswordVisibility}
                className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 z-10"
                aria-label={
                  showConfirmPassword ? "Hide password" : "Show password"
                }
              >
                {showConfirmPassword ? (
                  <FaEyeSlash size={15} />
                ) : (
                  <FaEye size={15} />
                )}
              </button>
              <Field
                as={Input}
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                className="mt-1 w-full pl-10"
              />
            </div>
            <ErrorMessage
              name="confirmPassword"
              component="div"
              className="text-red-500 text-sm mt-1"
            />
          </div>

          <Button
            type="submit"
            className="w-full bg-[#6A7282] text-white hover:bg-[#5A626F] transition-colors"
            disabled={isSubmitting || isPending}
          >
            {isSubmitting || isPending
              ? "Creating Account..."
              : "Create Account"}
          </Button>
        </Form>
      )}
    </Formik>
  );
}
