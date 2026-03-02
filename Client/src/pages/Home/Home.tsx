import { useState, useEffect, Suspense, lazy } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const { keepPlayingRedirect, setKeepPlayingRedirect } = useAuth();

  useEffect(() => {
    if (keepPlayingRedirect) {
      setIsSignUpModalOpen(true);
      setKeepPlayingRedirect(false);
    }
  }, [keepPlayingRedirect, setKeepPlayingRedirect]);

  // Check for openLogin URL parameter and auto-open login modal
  useEffect(() => {
    const shouldOpenLogin = searchParams.get("openLogin");
    if (shouldOpenLogin === "true") {
      setIsLoginModalOpen(true);
      // Clean up the URL parameter after opening the modal
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete("openLogin");
      setSearchParams(newSearchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

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
        />
      </Suspense>
      <Suspense fallback={<SectionFallback title="All games" count={9} />}>
        <AllGamesSection searchQuery={searchQuery} />
      </Suspense>
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
    </div>
  );
}

export default Home;
