import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { Button } from "../ui/button";
import { usePermissions } from "../../hooks/usePermissions";
import Logo from "../../assets/logo.svg";

import { IoMdSettings } from "react-icons/io";
// import { IoIosSearch } from "react-icons/io";
// import { CommandInput } from '../ui/command';
import { IoExitOutline } from "react-icons/io5";

import sun from "../../assets/sun.svg";
import moon from "../../assets/moon.svg";

const AdminNavbar: React.FC = () => {
  const { logout } = useAuth();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const permissions = usePermissions();

  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  // const [searchValue, setSearchValue] = useState("");

  const navigate = useNavigate();

  useEffect(() => {
    if (!showSearch) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowSearch(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSearch]);

  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  return (
    <header className="relative flex justify-between items-center bg-[#fef7ed] dark:bg-[#0f1221] transition-colors duration-300">
      {/* Logo */}
      <div
        onClick={() => navigate("/")}
        className="cursor-pointer flex justify-center items-center bg-gradient-to-t from-[#121C2D] to-[#475568] rounded-br-[40px] py-2 px-8 -mt-4 -ml-4"
      >
        <img src={Logo} alt="logo" className="w-12 pt-4" />
        <p className="text-[16px] md:text-[28px] text-center text-white dark:text-white font-bold font-jersey pt-4">
          Arcades Box
        </p>
      </div>

      {/* right side */}
      <div className="flex gap-4 items-center pt-4 pr-4">
        <div className="font-extrabold text-[#D946EF] dark:text-[#E879F9] flex items-center gap-4">
          {/* {!showSearch ? (
            <button
              aria-label="Open search"
              onClick={() => setShowSearch(true)}
              className="focus:outline-none"
            >
              <IoIosSearch className='w-6 h-6' />
            </button>
          ) : (
            <div className="relative">
              <input
                ref={searchInputRef}
                value={searchValue}
                onChange={e => setSearchValue(e.target.value)}
                placeholder="Search..."
                className="w-60 px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#D946EF] transition placeholder:text-gray-400 text-normal tracking-wider text-gray-400"
                onBlur={() => {
                  if (searchValue === "") setShowSearch(false);
                }}
                autoFocus
              />
              {searchValue && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  onClick={() => setSearchValue("")}
                  tabIndex={-1}
                >
                  &#10005;
                </button>
              )}
            </div>
          )} */}
          {permissions.canAccessConfig && (
            <IoMdSettings
              className="w-6 h-6 cursor-pointer text-[#6A7282]"
              onClick={() => navigate("/admin/settings")}
            />
          )}
        </div>
        <div className="space-x-4 flex items-center cursor-pointer">
          <img
            onClick={toggleDarkMode}
            src={isDarkMode ? moon : sun}
            alt={isDarkMode ? "light mode" : "dark mode"}
            className="w-6 h-6 cursor"
          />
          <Button
            onClick={() => {
              logout();
              navigate("/");
            }}
            className="bg-transparent flex items-center gap-2 text-red-500 hover:bg-red-500 hover:text-white cursor-pointer text-[15px]"
          >
            <IoExitOutline className="w-5 h-5" />
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
};

export default AdminNavbar;
