import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getConsentState, setConsent } from '../../utils/consent';

export default function CookieBanner() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Show until the user has made an explicit choice. Closing the banner
    // without choosing leaves state as 'pending' and re-prompts next visit
    // (GDPR-safe: no choice = no consent = no marketing tracking).
    setIsVisible(getConsentState() === 'pending');
  }, []);

  const handleAccept = () => {
    setConsent('accepted');
    setIsVisible(false);
  };

  const handleDecline = () => {
    setConsent('declined');
    setIsVisible(false);
  };

  const handlePreferences = () => {
    // TODO: Implement preferences modal/page
    console.log('Open preferences');
  };

  const handleClose = () => {
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-2 right-2 left-2 lg:left-auto z-50">
      <div className="max-w-5xl rounded-2xl bg-white pt-12 pb-6 px-4 sm:px-6 shadow-2xl border border-gray-200 dark:border-[#334154] dark:bg-[#0F1221]">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute right-3 top-2 text-[#334154] dark:text-white hover:text-gray-600 transition-colors"
          aria-label="Close cookie banner"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Main content */}
        <div className="flex flex-col lg:flex-row items-start gap-4 lg:gap-6">
          {/* Left side - Text content */}
          <div className="flex-1">
            <p className="text-gray-700 text-sm leading-relaxed dark:text-white">
              By clicking "Accept", you agree to the storing of cookies on your device to enhance site navigation, 
              analyze site usage, and assist in our marketing efforts.{' '}
              <Link 
                to="/privacy" 
                className="text-[#334154] underline transition-colors dark:text-white"
              >
                View our Privacy Policy
              </Link>{' '}
              for more information.
            </p>
          </div>

          {/* Right side - Preferences and buttons */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 w-full lg:w-auto">
            <button
              onClick={handlePreferences}
              className="text-[#0F1621] text-sm font-medium self-start sm:self-center"
            >
              Preferences
            </button>
            
            <div className="flex gap-3 w-full sm:w-auto">
              <button
                onClick={handleDecline}
                className="flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-3 text-sm font-medium text-[#0F1621] bg-white border-2 border-[#E2E8F0] rounded-[12px] hover:border-gray-400 hover:text-gray-800 transition-colors"
              >
                Decline
              </button>
              <button
                onClick={handleAccept}
                className="flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-3 text-sm font-medium text-white bg-[#334154] rounded-[12px] hover:bg-gray-600 transition-colors"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}