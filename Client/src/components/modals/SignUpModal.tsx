/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { useState } from 'react';
import { useCreateUser } from '../../backend/user.service';
import { useTrackSignupClick } from '../../backend/signup.analytics.service';
import { useSystemConfigByKey } from '../../backend/configuration.service';
// import { toast } from "sonner";
import { Formik, Form, Field, ErrorMessage } from 'formik';
import type { FormikHelpers, FieldProps } from 'formik';
import {
  boolean as yupBoolean,
  object as yupObject,
  string as yupString,
} from 'yup';
import {
  passwordSchema,
  confirmPasswordSchema,
} from '../../validation/password';
import LazyPhoneInput from '../ui/LazyPhoneInput';
import { Dialog, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { CustomDialogContent } from '../ui/custom-dialog-content';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import { Eye, EyeOff, User, Mail } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getOrCreateSessionId } from '../../utils/sessionUtils';
import { useUserCountry } from '../../hooks/useUserCountry';
import { WelcomeModal } from './WelcomeModal';

const getAuthFields = (config?: { value?: { settings: any } }) => {
  // CHANGE REQUEST: Force email-only authentication (phone number field disabled)
  // To re-enable phone number field, uncomment the original logic below and comment out the custom logic

  // Default state when no config or invalid config
  const defaultFields = {
    showAll: false,
    showEmail: true,
    showPhone: false, // CHANGED: Always false for email-only mode
    firstName: true,
    lastName: true,
  };

  if (!config?.value?.settings) return defaultFields;

  const { both, email, sms } = config.value.settings;

  // Guard against undefined settings
  if (!both || !email || !sms) return defaultFields;

  // Force email-only mode but respect firstName/lastName configuration
  if (email.enabled) {
    return {
      showAll: false,
      showEmail: true,
      showPhone: false, // CHANGED: Always false for email-only mode
      firstName: !!email.firstName,
      lastName: !!email.lastName,
    };
  }

  // Even if other modes are enabled, force email-only
  return {
    showAll: false,
    showEmail: true,
    showPhone: false, // CHANGED: Always false for email-only mode
    firstName: !!email.firstName,
    lastName: !!email.lastName,
  };

  /* ORIGINAL LOGIC - COMMENTED OUT
  // Default state when no config or invalid config
  const defaultFields = {
    showAll: true,
    showEmail: true,
    showPhone: true,
    firstName: true,
    lastName: true,
  };

  if (!config?.value?.settings) return defaultFields;

  const { both, email, sms } = config.value.settings;

  // Guard against undefined settings
  if (!both || !email || !sms) return defaultFields;

  if (both.enabled) {
    return {
      showAll: false,
      showEmail: true,
      showPhone: true,
      firstName: true,
      lastName: true,
    };
  }

  if (email.enabled) {
    return {
      showAll: false,
      showEmail: true,
      showPhone: false,
      firstName: !!email.firstName,
      lastName: !!email.lastName,
    };
  }

  if (sms.enabled) {
    return {
      showAll: false,
      showEmail: false,
      showPhone: true,
      firstName: !!sms.firstName,
      lastName: !!sms.lastName,
    };
  }

  return defaultFields;
  */
};

const getValidationSchema = (config?: { value?: { settings: any } }) => {
  const fields = getAuthFields(config);
  const schema: any = {
    password: passwordSchema,
    confirmPassword: confirmPasswordSchema,
    ageConfirm: yupBoolean()
      .oneOf([true], 'You must be 18+ years')
      .required('You must be 18+ years'),
    terms: yupBoolean()
      .oneOf([true], 'You must accept the terms of use')
      .required('You must accept the terms of use'),
  };

  if (fields.showAll || fields.showEmail) {
    schema.email = yupString()
      .email('Invalid email address')
      .required('Email is required');
  }

  if (fields.showAll || fields.showPhone) {
    schema.phoneNumber = yupString().required('Phone number is required');
  }

  if (fields.firstName) {
    schema.firstName = yupString().required('First name is required');
  }

  if (fields.lastName) {
    schema.lastName = yupString().required('Last name is required');
  }

  return yupObject(schema);
};

const getInitialValues = (config?: { value?: { settings: any } }) => {
  const fields = getAuthFields(config);
  const values: any = {
    password: '',
    confirmPassword: '',
    ageConfirm: false,
    terms: false,
  };

  if (fields.showAll || fields.showEmail) values.email = '';
  if (fields.showAll || fields.showPhone) values.phoneNumber = '';
  if (fields.firstName) values.firstName = '';
  if (fields.lastName) values.lastName = '';

  return values;
};

interface SignUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openLoginModal: () => void;
}

// Format phone number
const formatPhoneNumber = (value?: string) => (value ? `+${value}` : value);

export function SignUpModal({
  open,
  onOpenChange,
  openLoginModal,
}: SignUpDialogProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  // Phase 0 optimization: Only fetch auth settings when modal is opened
  const { data: config } = useSystemConfigByKey('authentication_settings', {
    enabled: open, // Only fetch when modal is open
  });
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { countryCode, isLoading: _isCountryLoading } = useUserCountry();

  const togglePasswordVisibility = () => setShowPassword(!showPassword);
  const toggleConfirmPasswordVisibility = () =>
    setShowConfirmPassword(!showConfirmPassword);

  const createUser = useCreateUser();
  const { mutate: trackSignup } = useTrackSignupClick();

  const handleSignUp = async (
    values: ReturnType<typeof getInitialValues>,
    actions: FormikHelpers<ReturnType<typeof getInitialValues>>
  ) => {
    try {
      // Track the final signup button click with session ID
      trackSignup({
        sessionId: getOrCreateSessionId(),
        type: 'signup-modal',
      });

      await createUser.mutateAsync({
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        password: values.password,
        phoneNumber: values.phoneNumber,
        isAdult: values.ageConfirm,
        hasAcceptedTerms: values.terms,
      });

      // Close signup modal
      onOpenChange(false);

      // Show welcome modal instead of immediately opening login
      setShowWelcomeModal(true);
    } catch (error: any) {
      actions.setStatus({ error: 'Failed to create account' });
    } finally {
      actions.setSubmitting(false);
    }
  };

  const handleWelcomeContinue = () => {
    setShowWelcomeModal(false);
    openLoginModal();
  };

  const navigate = useNavigate();
  const handleTerms = () => {
    onOpenChange(false);
    navigate('/terms');
  };

  const handlePrivacy = () => {
    onOpenChange(false);
    navigate('/privacy');
  };

  return (
    <>
      <WelcomeModal
        open={showWelcomeModal}
        onOpenChange={setShowWelcomeModal}
        onContinue={handleWelcomeContinue}
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
        <CustomDialogContent className="sm:max-w-[425px] max-h-[98vh] dark:bg-[#0F1221] p-4 sm:p-5">
          {/* Custom Close Button */}
          <button
            className="absolute -top-2 -right-2 sm:-top-4 sm:-right-4 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#6A7282] flex items-center justify-center shadow-lg hover:bg-[#5A626F] transition-colors"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            style={{ border: 'none' }}
          >
            <span className="text-white text-2xl font-bold">×</span>
          </button>
          <DialogHeader className="space-y-2 md:space-y-3 lg:space-y-4">
            <DialogTitle className="text-2xl font-bold text-[#6A7282] dark:text-white text-center font-dmmono">
              Sign Up
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[90vh] overflow-y-auto custom-scrollbar">
            <Formik
              initialValues={getInitialValues(config)}
              validationSchema={getValidationSchema(config)}
              onSubmit={handleSignUp}
              validateOnMount={false}
              validateOnChange={true}
              validateOnBlur={true}
            >
              {({ isSubmitting, isValid }) => (
                <Form className="space-y-0 flex flex-col">
                  <div className="pb-1 md:pb-2 lg:pb-3">
                    {/* Authentication Fields */}
                    {(() => {
                      const fields = getAuthFields(config);
                      return (
                        <>
                          {(fields.showAll || fields.showEmail) && (
                            <div className="relative">
                              <Label
                                htmlFor="email"
                                className="font-dmmono text-base text-black dark:text-white"
                              >
                                E-Mail
                              </Label>
                              <div className="relative">
                                <Mail
                                  size={15}
                                  className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500"
                                />
                                <Field
                                  as={Input}
                                  id="email"
                                  name="email"
                                  placeholder="Enter Email"
                                  className="mt-1 md:mt-1.5 lg:mt-2 bg-[#E2E8F0] border-0 pl-10 font-dmmono tracking-wider text-[11px] font-normal h-[48px]"
                                />
                              </div>
                              <ErrorMessage
                                name="email"
                                component="div"
                                className="text-red-500 mt-0.5 md:mt-1 font-dmmono text-sm tracking-wider"
                              />
                            </div>
                          )}

                          {(fields.showAll || fields.showPhone) && (
                            <div className="relative pt-2 md:pt-3 lg:pt-4">
                              <Label
                                htmlFor="phoneNumber"
                                className="font-dmmono text-base text-black dark:text-white"
                              >
                                Phone Number
                              </Label>
                              <Field name="phoneNumber">
                                {({ field, form }: FieldProps) => (
                                  <div className="w-full mt-2 md:mt-2.5 lg:mt-3">
                                    <LazyPhoneInput
                                      country={countryCode}
                                      value={field.value}
                                      onChange={(value) =>
                                        form.setFieldValue(
                                          'phoneNumber',
                                          formatPhoneNumber(value)
                                        )
                                      }
                                      inputStyle={{
                                        width: '100%',
                                        height: '48px',
                                        backgroundColor: '#E2E8F0',
                                        border: '0',
                                        borderRadius: '0.375rem',
                                        fontFamily: 'Dm Mono, cursive',
                                        fontSize: '11px',
                                      }}
                                      containerClass="dark:bg-[#191c2b]"
                                      buttonStyle={{
                                        backgroundColor: '#E2E8F0',
                                        border: '0',
                                        borderRadius: '0.375rem 0 0 0.375rem',
                                      }}
                                      dropdownStyle={{
                                        backgroundColor: '#E2E8F0',
                                        color: '#000',
                                        zIndex: 50,
                                      }}
                                      searchStyle={{
                                        backgroundColor: '##E2E8F0',
                                        color: '#000',
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
                                className="text-red-500 mt-0.5 md:mt-1 font-dmmono text-sm tracking-wider"
                              />
                            </div>
                          )}

                          {/* Name Fields */}
                          {(fields.firstName || fields.lastName) && (
                            <div className="flex space-x-4 mt-2 md:mt-3 lg:mt-4">
                              {fields.firstName && (
                                <div className="flex-1 relative">
                                  <Label
                                    htmlFor="firstName"
                                    className="font-dmmono text-base text-black dark:text-white"
                                  >
                                    First Name
                                  </Label>
                                  <div className="relative">
                                    <User
                                      size={15}
                                      className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500"
                                    />
                                    <Field
                                      as={Input}
                                      id="firstName"
                                      name="firstName"
                                      placeholder="Enter First Name"
                                      className="mt-1 md:mt-1.5 lg:mt-2 bg-[#E2E8F0] border-0 pl-10 font-dmmono text-lg tracking-wider text-[11px] font-normal h-[48px]"
                                    />
                                  </div>
                                  <ErrorMessage
                                    name="firstName"
                                    component="div"
                                    className="text-red-500 mt-0.5 md:mt-1 font-dmmono text-sm tracking-wider"
                                  />
                                </div>
                              )}
                              {fields.lastName && (
                                <div className="flex-1 relative">
                                  <Label
                                    htmlFor="lastName"
                                    className="font-dmmono text-base text-black dark:text-white"
                                  >
                                    Last Name
                                  </Label>
                                  <div className="relative">
                                    <User
                                      size={15}
                                      className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500"
                                    />
                                    <Field
                                      as={Input}
                                      id="lastName"
                                      name="lastName"
                                      placeholder="Enter Last Name"
                                      className="mt-1 md:mt-1.5 lg:mt-2 bg-[#E2E8F0] border-0 pl-10 font-dmmono text-lg tracking-wider text-[11px] font-normal h-[48px]"
                                    />
                                  </div>
                                  <ErrorMessage
                                    name="lastName"
                                    component="div"
                                    className="text-red-500 mt-0.5 md:mt-1 font-dmmono text-sm tracking-wider"
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}

                    {/* Password Fields */}
                    <div className="relative mt-2 md:mt-3 lg:mt-4">
                      <Label
                        htmlFor="password"
                        className="font-dmmono text-base text-black dark:text-white"
                      >
                        Password
                      </Label>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={togglePasswordVisibility}
                          className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500"
                          aria-label={
                            showPassword ? 'Hide password' : 'Show password'
                          }
                        >
                          {showPassword ? (
                            <EyeOff size={15} />
                          ) : (
                            <Eye size={15} />
                          )}
                        </button>
                        <Field
                          as={Input}
                          id="password"
                          name="password"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Enter Password"
                          className="mt-1 md:mt-1.5 lg:mt-2 bg-[#E2E8F0] border-0 pl-10 pr-10 font-dmmono text-lg tracking-wider text-[11px] font-normal h-[48px]"
                        />
                      </div>
                      <ErrorMessage
                        name="password"
                        component="div"
                        className="text-red-500 mt-0.5 md:mt-1 font-dmmono text-sm tracking-wider"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 md:mt-1 font-dmmono">
                        Password must be at least 6 characters with uppercase,
                        letters and numbers
                      </p>
                    </div>
                    <div className="relative mt-2 md:mt-3 lg:mt-4">
                      <Label
                        htmlFor="confirmPassword"
                        className="font-dmmono text-base text-black dark:text-white"
                      >
                        Confirm Password
                      </Label>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={toggleConfirmPasswordVisibility}
                          className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500"
                          aria-label={
                            showConfirmPassword
                              ? 'Hide password'
                              : 'Show password'
                          }
                        >
                          {showConfirmPassword ? (
                            <EyeOff size={15} />
                          ) : (
                            <EyeOff size={15} />
                          )}
                        </button>
                        <Field
                          as={Input}
                          id="confirmPassword"
                          name="confirmPassword"
                          type={showConfirmPassword ? 'text' : 'password'}
                          placeholder="Confirm Password"
                          className="mt-1 md:mt-1.5 lg:mt-2 bg-[#E2E8F0] border-0 pl-10 pr-10 font-dmmono text-lg tracking-wider text-[11px] font-normal h-[48px]"
                        />
                      </div>
                      <ErrorMessage
                        name="confirmPassword"
                        component="div"
                        className="text-red-500 mt-0.5 md:mt-1 font-dmmono text-sm tracking-wider"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 md:mt-1 font-dmmono">
                        Must match the password above
                      </p>
                    </div>
                    <div className="my-3 md:my-4 lg:my-5 flex flex-col gap-2 md:gap-3">
                      <div className="flex items-center space-x-2">
                        <Field name="ageConfirm">
                          {({ field, form }: FieldProps) => (
                            <Checkbox
                              id="ageConfirm"
                              checked={field.value}
                              onCheckedChange={(checked) => {
                                form.setFieldValue('ageConfirm', checked);
                                form.setFieldTouched('ageConfirm', true, false);
                              }}
                              className="border-2 border-gray-400 data-[state=checked]:bg-[#6A7282] data-[state=checked]:border-[#6A7282]"
                            />
                          )}
                        </Field>
                        <Label
                          htmlFor="ageConfirm"
                          className="font-dmmono text-black dark:text-white cursor-pointer text-xs"
                        >
                          I confirm to be over 18 years old
                        </Label>
                      </div>
                      <ErrorMessage
                        name="ageConfirm"
                        component="div"
                        className="text-red-500 font-dmmono text-sm tracking-wider"
                      />
                      <div className="flex items-start space-x-2">
                        <Field name="terms">
                          {({ field, form }: FieldProps) => (
                            <Checkbox
                              id="terms"
                              checked={field.value}
                              onCheckedChange={(checked) => {
                                form.setFieldValue('terms', checked);
                                form.setFieldTouched('terms', true, false);
                              }}
                              className="border-2 border-gray-400 data-[state=checked]:bg-[#6A7282] data-[state=checked]:border-[#6A7282]"
                            />
                          )}
                        </Field>
                        <Label
                          htmlFor="terms"
                          className="font-dmmono text-black dark:text-white cursor-pointer leading-6 text-xs text-start flex"
                        >
                          <div>
                            I confirm and accept the{' '}
                            <span
                              onClick={(e) => {
                                e.preventDefault();
                                handleTerms();
                              }}
                              className="text-[#6A7282] hover:underline cursor-pointer font-dmmono text-xs"
                            >
                              terms & conditions
                            </span>{' '}
                            and the{' '}
                            <span
                              onClick={(e) => {
                                e.preventDefault();
                                handlePrivacy();
                              }}
                              className="text-[#6A7282] hover:underline cursor-pointer font-dmmono text-xs"
                            >
                              privacy policy
                            </span>
                            {/* , which may include the collection, use, and sharing
                            of my data with third parties as described. */}
                          </div>
                        </Label>
                      </div>
                      <ErrorMessage
                        name="terms"
                        component="div"
                        className="text-red-500 font-dmmono text-sm tracking-wider"
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmitting || !isValid}
                    className="w-full bg-[#6A7282] hover:bg-[#5A626F] text-white font-dmmono cursor-pointer"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit'}
                  </Button>
                </Form>
              )}
            </Formik>

            <div className="flex flex-col flex-1 mt-3 md:mt-4 lg:mt-5">
              <p className=" text-center text-black dark:text-white font-dmmono text-sm tracking-wider">
                Already have an account?{' '}
                <button
                  className="underline text-[#6A7282] cursor-pointer font-dmmono text-sm"
                  onClick={openLoginModal}
                >
                  Login
                </button>
              </p>
              {/* terms and privacy */}
              <div className="font-worksans flex items-center space-x-2 text-sm justify-center">
                <button
                  className="text-[#6A7282] text-center cursor-pointer tracking-wider hover:underline"
                  onClick={handleTerms}
                >
                  Terms of Service
                </button>
                <span className="text-gray-400 dark:text-gray-500">/</span>
                <button
                  className="text-[#6A7282] text-center cursor-pointer tracking-wider hover:underline"
                  onClick={handlePrivacy}
                >
                  Privacy Policy
                </button>
              </div>
            </div>
          </div>
        </CustomDialogContent>
      </Dialog>
    </>
  );
}
