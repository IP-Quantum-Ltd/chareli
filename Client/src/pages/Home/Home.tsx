import { useState, Suspense, lazy, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useSystemConfigByKey } from "../../backend/configuration.service";

const PopularSection = lazy(
  () => import("../../components/single/PopularSection")
);
const AllGamesSection = lazy(
  () => import("../../components/single/AllGamesSection")
);
const SignUpModal = lazy(() =>
  import("../../components/modals/SignUpModal").then((module) => ({
    default: module.SignUpModal,
  }))
);
const LoginModal = lazy(() =>
  import("../../components/modals/LoginModal").then((module) => ({
    default: module.LoginModal,
  }))
);

const SectionFallback = ({ title, count = 9 }: { title: string; count?: number }) => (
  <div className="p-4">
    <h2 className="text-[#6A7282] dark:text-[#FEFEFE] text-3xl mb-4 font-worksans">
      {title}
    </h2>
    {/* Category tabs skeleton */}
    <div className="mb-8 h-10 bg-[#e2e8f0]/60 dark:bg-[#1f2937]/60 rounded-lg animate-pulse" />
    {/* Match actual grid with varied heights */}
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4 md:gap-6 auto-rows-[1fr] sm:auto-rows-[160px] md:auto-rows-[150px] all-games-grid min-h-[600px] sm:min-h-[500px]">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-[20px] bg-[#e2e8f0]/60 dark:bg-[#1f2937]/60"
          aria-label={`${title} item ${i + 1} loading`}
        />
      ))}
    </div>
  </div>
);

function Home() {
  const [isSignUpModalOpen, setIsSignUpModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Derive search state from URL, provide custom setter to update URL
  const searchQuery = searchParams.get("search") || "";
  const setSearchQuery = (query: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (query) {
      newParams.set("search", query);
    } else {
      newParams.delete("search");
    }
    setSearchParams(newParams, { replace: true });
  };
  const { keepPlayingRedirect, setKeepPlayingRedirect } = useAuth();
  const { data: publicAuthConfig } = useSystemConfigByKey("public_auth_settings");
  const isPublicAuthEnabled = publicAuthConfig?.value?.enabled === true;

  useEffect(() => {
    if (keepPlayingRedirect && isPublicAuthEnabled) {
      setIsSignUpModalOpen(true);
      setKeepPlayingRedirect(false);
    }
  }, [keepPlayingRedirect, setKeepPlayingRedirect, isPublicAuthEnabled]);

  // Check for openLogin URL parameter and auto-open login modal
  useEffect(() => {
    const shouldOpenLogin = searchParams.get("openLogin");
    if (shouldOpenLogin === "true" && isPublicAuthEnabled) {
      setIsLoginModalOpen(true);
      // Clean up the URL parameter after opening the modal
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete("openLogin");
      setSearchParams(newSearchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, isPublicAuthEnabled]);

  const handleOpenSignUpModal = () => {
    setIsSignUpModalOpen(true);
  };

  const handleOpenLoginModal = () => {
    setIsSignUpModalOpen(false);
    setIsLoginModalOpen(true);
  };

  return (
    <div className="font-dmmono">
      <h1 className="sr-only">Arcades Box - Play Free Online Arcade and Puzzle Games</h1>
      <Suspense fallback={<SectionFallback title="Popular games" />}>
        <PopularSection
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isPublicAuthEnabled={isPublicAuthEnabled}
        />
      </Suspense>
      <Suspense fallback={<SectionFallback title="All games" count={9} />}>
        <AllGamesSection searchQuery={searchQuery} />
      </Suspense>
      {isPublicAuthEnabled && (
        <>
          <Suspense fallback={null}>
            <SignUpModal
              open={isSignUpModalOpen}
              onOpenChange={setIsSignUpModalOpen}
              openLoginModal={handleOpenLoginModal}
            />
          </Suspense>
          <Suspense fallback={null}>
            <LoginModal
              open={isLoginModalOpen}
              onOpenChange={setIsLoginModalOpen}
              openSignUpModal={handleOpenSignUpModal}
            />
          </Suspense>
        </>
      )}
    </div>
  );
}

export default Home;
