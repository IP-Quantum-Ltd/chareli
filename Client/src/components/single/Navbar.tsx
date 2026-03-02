import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { StatsModal } from "../modals/StatsModal";
import { ProfileModal } from "../modals/ProfileModal";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useTrackSignupClick } from "../../backend/signup.analytics.service";
import { getOrCreateSessionId } from "../../utils/sessionUtils";
import { usePermissions } from "../../hooks/usePermissions";
import Logo from "../../assets/logo.svg";
import aboutIcon from "../../assets/about.svg";
import categoryIcon from "../../assets/category.svg";

import sun from "../../assets/sun.svg";
import moon from "../../assets/moon.svg";
// import bolt from '../../assets/bolt.svg';


import { SignUpModal } from "../modals/SignUpModal";
import { LoginModal } from "../modals/LoginModal";
import { CircleUserRound, Menu} from "lucide-react";

const Navbar: React.FC = () => {
  const { isAuthenticated, logout } = useAuth();
  const permissions = usePermissions();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { mutate: trackSignup } = useTrackSignupClick();

  const navigate = useNavigate();
  const [isSignUpModalOpen, setIsSignUpModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target as Node) &&
        !menuButtonRef.current?.contains(event.target as Node)
      ) {
        setIsMobileMenuOpen(false);
      }

      // Close desktop menu when clicking outside
      // Desktop menu functionality removed
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <header className="relative flex justify-between items-center bg-[#fef7ed] dark:bg-[#0f1221] transition-colors duration-300">
      {/* Logo */}
      <div
        onClick={() => navigate("/")}
        className="cursor-pointer flex justify-center items-center bg-gradient-to-t from-[#121C2D] to-[#475568] rounded-br-[40px] py-2 px-8 -mt-4 -ml-4"
      >
        <img src={Logo} alt="logo" className="w-12 pt-4 " />
        <p className="text-[20.22px] lg:text-[40px] text-center text-white dark:text-white font-bold font-jersey pt-4">
          Arcades Box
        </p>
      </div>

      {/* Desktop Navigation - Center */}
      <div className="hidden lg:flex gap-4 text-[16px] font-bold text-white items-center justify-center flex-1 pt-2">
        <Link
          to="/about"
          className="bg-[#6A7282] text-white px-4 py-2 rounded-md transition-colors duration-300 hover:bg-[#5A626F] flex items-center gap-2"
        >
          <img src={aboutIcon} alt="About" className="w-5 h-5" />
          About Us
        </Link>
        <Link
          to="/categories"
          className="bg-[#6A7282] text-white px-4 py-2 rounded-md transition-colors duration-300 hover:bg-[#5A626F] flex items-center gap-2"
        >
          <img src={categoryIcon} alt="Category" className="w-5 h-5" />
          Categories
        </Link>
      </div>

      {/* Mobile Menu Button and Theme Toggle */}
      <div className="lg:hidden flex items-center space-x-2 mx-2">
        {/* Mobile Theme Toggle */}
        <button
          onClick={toggleDarkMode}
          className="text-white bg-[#6A7282] py-2 px-2 rounded-3xl flex items-center justify-center hover:bg-[#5A626F] transition-colors"
        >
          <img
            src={isDarkMode ? moon : sun}
            alt={isDarkMode ? "light mode" : "dark mode"}
            className="w-5 h-5"
          />
        </button>

        <button
          ref={menuButtonRef}
          className="text-white bg-[#6A7282] py-2 px-3 pt-4 rounded-md flex items-center justify-center hover:bg-[#5A626F] transition-colors"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          {isMobileMenuOpen ? (
            <Menu className="w-6 h-6" />
          ) : (
            <Menu className="w-6 h-6" />
          )}
        </button>
      </div>

      {/* Mobile Navigation */}
      {isMobileMenuOpen && (
        <div
          ref={mobileMenuRef}
          className="absolute top-full right-0 mt-2 mx-2 bg-white dark:bg-[#0f1221] shadow-lg lg:hidden z-50 border border-gray-200 dark:border-gray-800 rounded-lg min-w-[300px]"
        >
          <div className="flex flex-col p-4 gap-2">
            <div className=" text-[15px]">
              <Link
                to="/about"
                className="block text-[#111826] dark:text-white px-4 py-3 rounded-xl font-semibold transition-all duration-300"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                About Us
              </Link>
              <Link
                to="/categories"
                className="block text-[#111826] dark:text-white px-4 py-3 rounded-xl font-semibold transition-all duration-300"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Categories
              </Link>
            </div>
            {isAuthenticated ? (
              <div className="space-y-3">
                {permissions.hasAdminAccess && (
                  <Button
                    onClick={() => {
                      navigate("/admin");
                      setIsMobileMenuOpen(false);
                    }}
                    className="bg-[#6A7282] text-white hover:bg-[#5A626F] w-full py-3 rounded-lg font-semibold shadow-lg transform hover:scale-[1.02] transition-all duration-300 text-[15px]"
                  >
                    Admin Dashboard
                  </Button>
                )}

                {/* <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => {
                      setIsStatsModalOpen(true);
                      setIsMobileMenuOpen(false);
                    }}
                    className="flex items-center justify-center gap-2 bg-gradient-to-r from-[#D946EF] to-[#DC8B18] text-white px-4 py-4 rounded-xl hover:from-[#DC8B18] hover:to-[#A21CAF] transition-all duration-300 shadow-lg transform hover:scale-[1.05]"
                  >
                    <img
                      src={bolt}
                      alt="bolt"
                      className="w-4 h-4 filter brightness-0 invert"
                    />
                    <span className="text-sm font-semibold">Stats</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsProfileModalOpen(true);
                      setIsMobileMenuOpen(false);
                    }}
                    className="bg-[#DC8B18] text-white w-full py-3 rounded-lg font-semibold shadow-lg transform hover:scale-[1.02] transition-all duration-300 text-[15px]"
                  >
                    Profile
                  </button>
                </div> */}

                <button
                  onClick={() => {
                    setIsProfileModalOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="bg-[#6A7282] text-white w-full py-2 rounded-lg font-semibold shadow-lg transform hover:scale-[1.02] transition-all duration-300 text-[15px] hover:bg-[#5A626F]"
                >
                  Profile
                </button>
                <Button
                  onClick={() => {
                    logout();
                    navigate("/");
                    setIsMobileMenuOpen(false);
                  }}
                  className="bg-transparent border-2 border-red-500 text-red-500 hover:bg-red-500 hover:text-white w-full py-3 rounded-lg font-semibold transition-all duration-300 transform hover:scale-[1.02] text-[15px]"
                >
                  Logout
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Button
                  onClick={() => {
                    setIsLoginModalOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="bg-[#6A7282] text-white text-[15px] w-full py-3 rounded-lg font-semibold transition-all duration-300 transform hover:scale-[1.02] hover:bg-[#5A626F]"
                >
                  Log in
                </Button>
                <Button
                  onClick={() => {
                    trackSignup({
                      sessionId: getOrCreateSessionId(),
                      type: "navbar",
                    });
                    setIsSignUpModalOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="bg-transparent border border-[#6A7282] text-[#6A7282] text-[15px] w-full py-3 rounded-lg font-semibold transition-all duration-300 transform hover:scale-[1.02] hover:bg-[#6A7282] hover:text-white"
                >
                  Sign up
                </Button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Modals - Available for both mobile and desktop */}
      <SignUpModal
        open={isSignUpModalOpen}
        onOpenChange={setIsSignUpModalOpen}
        openLoginModal={() => {
          setIsSignUpModalOpen(false);
          setIsLoginModalOpen(true);
        }}
      />
      <LoginModal
        open={isLoginModalOpen}
        onOpenChange={setIsLoginModalOpen}
        openSignUpModal={() => {
          setIsLoginModalOpen(false);
          setIsSignUpModalOpen(true);
        }}
      />
      <StatsModal
        open={isStatsModalOpen}
        onClose={() => setIsStatsModalOpen(false)}
      />
      <ProfileModal
        open={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />

      {/* Desktop Actions */}
      <div className="hidden lg:flex space-x-4 items-center pt-2 pr-4">
        <img
          onClick={toggleDarkMode}
          src={isDarkMode ? moon : sun}
          alt={isDarkMode ? "light mode" : "dark mode"}
          className="w-6 h-6 cursor-pointer"
        />

        {isAuthenticated ? (
          <>
            {permissions.hasAdminAccess && (
              <Button
                onClick={() => navigate("/admin")}
                className="bg-[#6A7282] text-white hover:bg-[#5A626F] cursor-pointer text-[15px] transition-colors"
              >
                Admin Dashboard
              </Button>
            )}

            {/* <img
              src={bolt}
              alt="bolt"
              className="cursor-pointer"
              onClick={() => setIsStatsModalOpen(true)}
            /> */}

            <CircleUserRound
              className="cursor-pointer text-[#6A7282] w-6 h-6 hover:text-[#5A626F] transition-colors"
              onClick={() => setIsProfileModalOpen(true)}
            />

            {/* Logout Button */}
            <Button
              onClick={() => {
                logout();
                navigate("/");
              }}
              className="bg-transparent border border-red-500 text-red-500 hover:bg-red-500 hover:text-white cursor-pointer text-[15px]"
            >
              Logout
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => setIsLoginModalOpen(true)}
              className="bg-[#6A7282] text-white hover:bg-[#5A626F] text-[15px] cursor-pointer transition-colors"
            >
              Log in
            </Button>
            <Button
              onClick={() => {
                trackSignup({
                  sessionId: getOrCreateSessionId(),
                  type: "navbar",
                });
                setIsSignUpModalOpen(true);
              }}
              className="bg-transparent border border-[#6A7282] text-[#6A7282] text-[15px] hover:bg-[#6A7282] hover:text-white cursor-pointer transition-colors"
            >
              Sign up
            </Button>

            {/* Desktop Menu Dropdown */}
            {/* <div className="relative desktop-menu-container">
              <Button
                onClick={() => setIsDesktopMenuOpen(!isDesktopMenuOpen)}
                className="bg-[#334154] text-white hover:bg-[#475568]"
              >
                <Menu className="w-[21px] h-[21px]" />
              </Button>

              {isDesktopMenuOpen && (
                <div className="absolute top-full right-0 mt-2 bg-white dark:bg-[#0f1221] shadow-lg z-50 border border-gray-200 dark:border-gray-800 rounded-lg min-w-[200px]">
                  <div className="flex flex-col p-4 gap-2">
                    <span className="text-[#111826] dark:text-white px-4 py-2 text-sm text-center">
                      Quick access menu
                    </span>
                  </div>
                </div>
              )}
            </div> */}

          </>
        )}
      </div>
    </header>
  );
};

export default Navbar;
