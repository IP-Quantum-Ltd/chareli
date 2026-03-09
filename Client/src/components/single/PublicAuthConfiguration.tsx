import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Label } from "../ui/label";
import { Checkbox } from "../ui/checkbox";
import { useSystemConfigByKey } from "../../backend/configuration.service";
import { Loader2 } from "lucide-react";

export interface PublicAuthConfigurationRef {
  getSettings: () => {
    enabled: boolean;
  };
}

interface PublicAuthConfigurationProps {
  disabled?: boolean;
  onChange?: () => void;
}

const PublicAuthConfiguration = forwardRef<
  PublicAuthConfigurationRef,
  PublicAuthConfigurationProps
>(({ disabled, onChange }, ref) => {
  const [enabled, setEnabled] = useState(false);

  const { data: configData, isLoading } = useSystemConfigByKey(
    "public_auth_settings"
  );

  useEffect(() => {
    if (configData?.value?.enabled !== undefined) {
      setEnabled(configData.value.enabled);
    }
  }, [configData]);

  useImperativeHandle(ref, () => ({
    getSettings: () => ({
      enabled,
    }),
  }));

  if (isLoading) {
    return (
      <div className="mb-6 bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[#6A7282]" />
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg sm:text-xl font-worksans text-[#6A7282] dark:text-white">
          Public Authentication
        </h2>
        {configData?.value?.enabled !== undefined && (
          <div className="bg-blue-50 dark:bg-blue-900/20 px-3 py-1 rounded-md">
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
              Current: {configData.value.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
        )}
      </div>
      <div className="space-y-6">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="enable-public-auth"
            checked={enabled}
            onCheckedChange={(checked) => {
              setEnabled(checked === true);
              onChange?.();
            }}
            disabled={disabled}
            color="#6A7282"
          />
          <Label
            htmlFor="enable-public-auth"
            className="text-base font-medium text-black dark:text-white cursor-pointer"
          >
            Enable public Login and Sign Up flows
          </Label>
        </div>
        {!enabled && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-6">
            When disabled, non-admin users will not see the login or signup buttons.
            (The direct /admin/login path will still function for administrators.)
          </p>
        )}
      </div>
    </div>
  );
});

PublicAuthConfiguration.displayName = "PublicAuthConfiguration";

export default PublicAuthConfiguration;
