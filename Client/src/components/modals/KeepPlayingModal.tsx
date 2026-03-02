import { useTrackSignupClick } from '../../backend/signup.analytics.service';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSystemConfigByKey } from '../../backend/configuration.service';
import { getOrCreateSessionId } from '../../utils/sessionUtils';
import { decodeHtmlEntities } from '../../utils/main';

interface KeepPlayingModalProps {
  open: boolean;
  openSignUpModal: () => void;
  isGameLoading?: boolean;
}

export default function KeepPlayingModal({ open, isGameLoading }: KeepPlayingModalProps) {
  const { mutate: trackSignup } = useTrackSignupClick();
  const navigate = useNavigate();
  const { setKeepPlayingRedirect } = useAuth();

  const handleSignupClick = () => {
    trackSignup({
      sessionId: getOrCreateSessionId(),
      type: 'keep-playing'
    });
    setKeepPlayingRedirect(true);
    navigate('/');
  };

  const { data: popupConfig } = useSystemConfigByKey('popup');

  if (!open || isGameLoading) return null;

  const title = popupConfig?.value?.title ? decodeHtmlEntities(popupConfig.value.title) : "Time's Up!";
  const subtitle = popupConfig?.value?.subtitle ? decodeHtmlEntities(popupConfig.value.subtitle) : "Sign up to keep playing this game and unlock unlimited access to all games!";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
      <div className="relative bg-white dark:bg-[#475568] rounded-2xl shadow-xl p-4 sm:p-6 md:p-8 w-[90%] sm:w-[450px] md:w-[500px] lg:w-[550px] max-w-[90vw] border-4 border-[#6A7282]">
        <div className="flex flex-col items-center max-w-[90%] mx-auto">
          <h1 className="text-lg sm:text-xl lg:text-xl tracking-wide font-extrabold mb-3 sm:mb-4 text-[#18181b] dark:text-white text-center">{title}</h1>
          <p className="text-base sm:text-md lg:text-lg text-center mb-4 sm:mb-6 text-gray-600 dark:text-gray-300">{subtitle}</p>
          <div className='flex items-center justify-center'>
            <button
              onClick={handleSignupClick}
              className='bg-[#6A7282] hover:bg-[#5A626F] text-white text-base sm:text-md lg:text-lg font-bold py-2 sm:py-3 px-4 sm:px-6 rounded-xl transition-colors cursor-pointer'
            >
              Sign Up Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
