import { useState, useEffect, useRef, useCallback } from 'react';
import { useBlocker } from 'react-router-dom';
import { Checkbox } from '../../../components/ui/checkbox';
import { Label } from '../../../components/ui/label';
import { useCreateSystemConfig, useSystemConfigByKey } from '../../../backend/configuration.service';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { BackendRoute } from '../../../backend/constants';
import { backendService } from '../../../backend/api.service';
import SearchBarConfiguration, { type SearchBarConfigurationRef } from '../../../components/single/SearchBarConfiguration';
import DynamicPopupConfiguration from '../../../components/single/DynamicPopupConfiguration';
import UserInactivityConfiguration, { type UserInactivityConfigurationRef } from '../../../components/single/UserInactivityConfiguration';
import PopularGamesConfiguration, { type PopularGamesConfigurationRef } from '../../../components/single/PopularGamesConfiguration';
import AboutMissionConfiguration, { type AboutMissionConfigurationRef } from '../../../components/single/AboutMissionConfiguration';
import BulkFreeTimeConfiguration, { type BulkFreeTimeConfigurationRef } from '../../../components/single/BulkFreeTimeConfiguration';
import { UnsavedChangesModal } from '../../../components/modals/UnsavedChangesModal';

interface AuthMethodSettings {
  enabled: boolean;
  firstName: boolean;
  lastName: boolean;
}

interface AuthSettings {
  email: AuthMethodSettings;
  sms: AuthMethodSettings;
  both: {
    enabled: boolean;
    otpDeliveryMethod: 'email' | 'sms' | 'none';
  };
}

export default function Configuration() {
  // CHANGE REQUEST: Force email-only authentication with OTP via email
  const [authSettings, setAuthSettings] = useState<AuthSettings>({
    email: {
      enabled: true,
      firstName: true,
      lastName: true
    },
    sms: {
      enabled: false,
      firstName: false,
      lastName: false
    },
    both: {
      enabled: false,
      otpDeliveryMethod: 'email'
    }
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const searchBarConfigRef = useRef<SearchBarConfigurationRef>(null);
  const userInactivityConfigRef = useRef<UserInactivityConfigurationRef>(null);
  const popularGamesConfigRef = useRef<PopularGamesConfigurationRef>(null);
  const aboutMissionConfigRef = useRef<AboutMissionConfigurationRef>(null);
  const bulkFreeTimeConfigRef = useRef<BulkFreeTimeConfigurationRef>(null);
  const queryClient = useQueryClient();
  const { mutateAsync: createConfig } = useCreateSystemConfig();
  const { data: configData, isLoading: isLoadingConfig } = useSystemConfigByKey('authentication_settings');

  // Load initial configuration
  useEffect(() => {
    if (configData?.value?.settings) {
      setAuthSettings(configData.value.settings);
    }
  }, [configData]);

  // Mark page as having unsaved changes
  const markDirty = useCallback(() => {
    setHasUnsavedChanges(true);
  }, []);

  // Browser beforeunload event - warns when closing/refreshing with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        // Modern browsers ignore custom messages, but the prompt will still show
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // React Router blocker - shows modal when navigating away with unsaved changes
  const blocker = useBlocker(hasUnsavedChanges);

  // const handleEmailAuth = (checked: boolean) => {
  //   setAuthSettings({
  //     email: {
  //       enabled: checked,
  //       firstName: false,
  //       lastName: false
  //     },
  //     sms: {
  //       enabled: false,
  //       firstName: false,
  //       lastName: false
  //     },
  //     both: {
  //       enabled: false,
  //       otpDeliveryMethod: 'none'
  //     }
  //   });
  // };

  const handleSmsAuth = (checked: boolean) => {
    markDirty();
    setAuthSettings({
      email: {
        enabled: false,
        firstName: false,
        lastName: false
      },
      sms: {
        enabled: checked,
        firstName: false,
        lastName: false
      },
      both: {
        enabled: false,
        otpDeliveryMethod: 'none'
      }
    });
  };

  const handleBoth = (checked: boolean) => {
    markDirty();
    setAuthSettings({
      email: {
        enabled: false,
        firstName: false,
        lastName: false
      },
      sms: {
        enabled: false,
        firstName: false,
        lastName: false
      },
      both: {
        enabled: checked,
        otpDeliveryMethod: 'none'
      }
    });
  };

  const handleEmailFirstName = (checked: boolean) => {
    markDirty();
    setAuthSettings(prev => ({
      ...prev,
      email: {
        ...prev.email,
        firstName: checked
      }
    }));
  };

  const handleEmailLastName = (checked: boolean) => {
    markDirty();
    setAuthSettings(prev => ({
      ...prev,
      email: {
        ...prev.email,
        lastName: checked
      }
    }));
  };

  const handleSmsFirstName = (checked: boolean) => {
    markDirty();
    setAuthSettings(prev => ({
      ...prev,
      sms: {
        ...prev.sms,
        firstName: checked
      }
    }));
  };

  const handleSmsLastName = (checked: boolean) => {
    markDirty();
    setAuthSettings(prev => ({
      ...prev,
      sms: {
        ...prev.sms,
        lastName: checked
      }
    }));
  };

  const handleOtpDeliveryMethod = (method: 'email' | 'sms' | 'none') => {
    markDirty();
    setAuthSettings(prev => ({
      ...prev,
      both: {
        ...prev.both,
        otpDeliveryMethod: method
      }
    }));
  };

  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      // Save authentication settings
      await createConfig({
        key: 'authentication_settings',
        value: {
          settings: authSettings
        }
      });

      // Save UI settings
      if (searchBarConfigRef.current) {
        const uiSettings = searchBarConfigRef.current.getSettings();
        await createConfig({
          key: 'ui_settings',
          value: uiSettings,
          description: 'UI visibility settings for the application'
        });
      }

      // Save user inactivity settings
      if (userInactivityConfigRef.current) {
        const inactivitySettings = userInactivityConfigRef.current.getSettings();
        await createConfig({
          key: 'user_inactivity_settings',
          value: inactivitySettings,
          description: 'User inactivity timer configuration'
        });
      }

      // Save popular games settings
      if (popularGamesConfigRef.current) {
        const popularGamesSettings = popularGamesConfigRef.current.getSettings();
        await createConfig({
          key: 'popular_games_settings',
          value: popularGamesSettings,
          description: 'Popular games configuration for homepage'
        });

        // Invalidate games queries to refresh popular section
        queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
      }

      // Save about & mission settings
      if (aboutMissionConfigRef.current) {
        const aboutMissionSettings = aboutMissionConfigRef.current.getSettings();
        await createConfig({
          key: 'about_mission_settings',
          value: aboutMissionSettings,
          description: 'About Us and Mission text configuration'
        });
      }

      // Save bulk free time settings and update all games
      if (bulkFreeTimeConfigRef.current) {
        const bulkFreeTimeSettings = bulkFreeTimeConfigRef.current.getSettings();

        // Save the configuration
        await createConfig({
          key: 'bulk_free_time_settings',
          value: bulkFreeTimeSettings,
          description: 'Default free game time configuration'
        });

        // Update all games with the new free time
        try {
          await backendService.post('/api/games/bulk-update-free-time', {
            freeTime: bulkFreeTimeSettings.defaultFreeTime
          });

          // Invalidate games queries to refresh the cache
          queryClient.invalidateQueries({ queryKey: [BackendRoute.GAMES] });
        } catch (bulkUpdateError) {
          console.error('Error updating games in bulk:', bulkUpdateError);
          // Don't fail the whole save if bulk update fails
        }
      }

      toast.success('Configuration saved successfully!');
      setHasUnsavedChanges(false); // Reset dirty state on successful save
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      toast.error('Failed to save configuration');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen p-4 bg-[#F1F5F9] dark:bg-[#121C2D] text-gray-800 dark:text-gray-200 relative">
      {/* Unsaved Changes Modal for in-app navigation */}
      <UnsavedChangesModal
        open={blocker.state === 'blocked'}
        onOpenChange={() => {}}
        onStay={() => blocker.reset?.()}
        onConfirmLeave={() => blocker.proceed?.()}
      />

      {isLoadingConfig && (
        <div className="absolute inset-0 bg-white/50 dark:bg-gray-900/50 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#6A7282]" />
        </div>
      )}

      <SearchBarConfiguration ref={searchBarConfigRef} disabled={isSubmitting} onChange={markDirty} />

      <h1 className="text-lg sm:text-xl font-worksans text-[#6A7282] dark:text-white mb-4">User Sign Up Configuration</h1>
      <div className="space-y-4">
        {/* Email Authentication Section - ACTIVE (Email-only mode) */}
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg border-2 border-green-500">
          <div className="flex items-center mb-2">
            <Checkbox
              checked={true}
              onCheckedChange={() => {}}
              id="email-auth"
              color="#6A7282"
              disabled={false}
            />
            <Label htmlFor="email-auth" className="ml-2 text-lg font-medium text-black dark:text-white">
              Email Authentication <span className="text-sm text-green-600 dark:text-green-400 font-bold">(✓ Required - Always Active)</span>
            </Label>
          </div>
          <div className="ml-6 space-y-2">
            <div className="flex items-center">
              <Checkbox
                checked={authSettings.email.firstName}
                onCheckedChange={handleEmailFirstName}
                id="first-name-email"
                disabled={false}
                color="#6A7282"
              />
              <Label htmlFor="first-name-email" className="ml-2 text-base">
                First Name
              </Label>
            </div>
            <div className="flex items-center">
              <Checkbox
                checked={authSettings.email.lastName}
                onCheckedChange={handleEmailLastName}
                id="last-name-email"
                disabled={false}
                color="#6A7282"
              />
              <Label htmlFor="last-name-email" className="ml-2 text-base">
                Last Name
              </Label>
            </div>
          </div>
        </div>

        {/* SMS Authentication Section - DISABLED (Email-only requirement) */}
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg opacity-50">
          <div className="flex items-center mb-2">
            <Checkbox
              checked={authSettings.sms.enabled}
              onCheckedChange={handleSmsAuth}
              id="sms-auth"
              color="#6A7282"
              disabled={true}
            />
            <Label htmlFor="sms-auth" className="ml-2 text-lg font-medium text-black dark:text-white">
              SMS Authentication <span className="text-sm text-gray-500">(Disabled - Email-only mode)</span>
            </Label>
          </div>
          <div className="ml-6 space-y-2">
            <div className="flex items-center">
              <Checkbox
                checked={authSettings.sms.firstName}
                onCheckedChange={handleSmsFirstName}
                id="first-name-sms"
                disabled={true}
                color="#6A7282"
              />
              <Label htmlFor="first-name-sms" className="ml-2 text-base">
                First Name
              </Label>
            </div>
            <div className="flex items-center">
              <Checkbox
                checked={authSettings.sms.lastName}
                onCheckedChange={handleSmsLastName}
                id="last-name-sms"
                disabled={true}
              color="#6A7282"
              />
              <Label htmlFor="last-name-sms" className="ml-2 text-base">
                Last Name
              </Label>
            </div>
          </div>
        </div>

        {/* Both Section - DISABLED (Email-only requirement) */}
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg opacity-50">
          <div className="flex items-center mb-2">
            <Checkbox
              checked={authSettings.both.enabled}
              onCheckedChange={handleBoth}
              id="both"
              color="#6A7282"
              disabled={true}
            />
            <Label htmlFor="both" className="ml-2 text-lg font-medium text-black dark:text-white">
              Both <span className="text-sm text-gray-500">(Disabled - Email-only mode)</span>
            </Label>
          </div>

          {/* OTP Delivery Method Selection */}
          {authSettings.both.enabled && (
            <div className="ml-6 mt-4">
              <Label className="text-base font-medium text-black dark:text-white mb-3 block">
                OTP Delivery Method:
              </Label>
              <div className="space-y-2">
                <div className="flex items-center">
                  <input
                    type="radio"
                    id="otp-email"
                    name="otpDeliveryMethod"
                    value="email"
                    checked={authSettings.both.otpDeliveryMethod === 'email'}
                    onChange={() => handleOtpDeliveryMethod('email')}
                    className="w-4 h-4 text-[#6A7282] bg-gray-100 border-gray-300 dark:bg-gray-700 dark:border-gray-600"
                    disabled
                  />
                  <Label htmlFor="otp-email" className="ml-2 text-base">
                    Email
                  </Label>
                </div>
                <div className="flex items-center">
                  <input
                    type="radio"
                    id="otp-sms"
                    name="otpDeliveryMethod"
                    value="sms"
                    checked={authSettings.both.otpDeliveryMethod === 'sms'}
                    onChange={() => handleOtpDeliveryMethod('sms')}
                    className="w-4 h-4 text-[#6A7282] bg-gray-100 border-gray-300 dark:bg-gray-700 dark:border-gray-600"
                    disabled
                  />
                  <Label htmlFor="otp-sms" className="ml-2 text-base">
                    SMS
                  </Label>
                </div>
                <div className="flex items-center">
                  <input
                    type="radio"
                    id="otp-none"
                    name="otpDeliveryMethod"
                    value="none"
                    checked={authSettings.both.otpDeliveryMethod === 'none'}
                    onChange={() => handleOtpDeliveryMethod('none')}
                    className="w-4 h-4 text-[#6A7282] bg-gray-100 border-gray-300 dark:bg-gray-700 dark:border-gray-600"
                    disabled
                  />
                  <Label htmlFor="otp-none" className="ml-2 text-base">
                    None (No OTP required)
                  </Label>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <DynamicPopupConfiguration />
      <UserInactivityConfiguration ref={userInactivityConfigRef} disabled={isSubmitting} onChange={markDirty} />
      <PopularGamesConfiguration ref={popularGamesConfigRef} disabled={isSubmitting} onChange={markDirty} />
      <AboutMissionConfiguration ref={aboutMissionConfigRef} disabled={isSubmitting} onChange={markDirty} />
      <BulkFreeTimeConfiguration ref={bulkFreeTimeConfigRef} disabled={isSubmitting} onChange={markDirty} />

      <div className="flex justify-end mt-6 mb-4 px-2">
        <button
          className="bg-[#6A7282] text-white px-6 py-3 rounded-lg hover:bg-[#5A626F] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer font-medium text-sm sm:text-base min-w-[140px] justify-center shadow-lg"
          onClick={handleSave}
          disabled={isSubmitting || isLoadingConfig}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Configuration'
          )}
        </button>
      </div>
    </div>
  );
}
