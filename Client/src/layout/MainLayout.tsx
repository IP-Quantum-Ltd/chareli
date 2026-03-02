import React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Navbar from "../components/single/Navbar";
import CookieBanner from "../components/single/CookieBanner";

const MainLayout: React.FC = () => {
  const location = useLocation();

  const navigation = useNavigate();
  const handleTermsPage = () => {
    navigation("/terms");
  };

  const handlePrivacyPage = () => {
    navigation("/privacy");
  };

  const isGamePlay = location.pathname.includes("/gameplay/");
  return (
    <div className="min-h-screen bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 transition-colors duration-300 flex flex-col">
      <Navbar />
      <main className="flex-1 bg-[#fef7ed] dark:bg-[#0f1221]">
        <Outlet />
      </main>
      {!isGamePlay && (
        <footer className="text-center text-white dark:white py-4 md:py-6 lg:py-8 bg-[#6A7282] dark:bg-[#6A7282] w-full">
          <div className="w-[90%] md:w-[85%] lg:w-[800px] mx-auto px-4 md:px-6">
            <p className="font-dmmono mb-3 text-[12px] sm:text-xs md:text-sm">
              This platform is owned and operated by Arcades Box, an online gaming community. All games featured on the platform are licensed to Arcades Box and remain the property of their respective creators or copyright holders.
            </p>

            <p className="font-worksans text-[10px] sm:text-xs md:text-sm mt-3 leading-relaxed">
              By using this service, you agree to the Arcades Box{" "}
                              <span
                  className="text-[#0F1621] underline cursor-pointer hover:text-[#FEF3C7] transition-colors font-semibold"
                  onClick={handleTermsPage}
                >
                  Terms of Service
                </span>
                . The Arcades Box{" "}
                <span
                  className="text-[#0F1621] underline cursor-pointer hover:text-[#FEF3C7] transition-colors font-semibold"
                  onClick={handlePrivacyPage}
                >
                  Privacy Policy
                </span>{" "}
              sets out how we handle your data.
            </p>

            <p className="font-worksans text-[10px] sm:text-xs md:text-sm leading-relaxed">
              Arcades Box uses cookies to improve our services and analyze traffic.
              By continuing to use Arcades Box, you consent to cookies as explained
              in our Privacy Policy.
            </p>
          </div>
        </footer>
      )}
      <CookieBanner />
    </div>
  );
};

export default MainLayout;
