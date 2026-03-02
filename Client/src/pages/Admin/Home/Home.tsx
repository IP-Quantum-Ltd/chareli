import click from '../../../assets/click.svg';
import usersLine from '../../../assets/users-line.svg';
import { Card } from '../../../components/ui/card';
import { AcceptInvitationModal } from '../../../components/modals/AdminModals/AcceptInvitationModal';
import { DashboardTimeFilter } from '../../../components/single/DashboardTimeFilter';
import { DashboardCountryFilter } from '../../../components/single/DashboardCountryFilter';
import { DashboardTimezoneFilter } from '../../../components/single/DashboardTimezoneFilter';
import StatsCard from './StatsCard';
import PieChart from '../../../components/charts/piechart';
import { useState } from 'react';
import { useSignupAnalyticsData } from '../../../backend/signup.analytics.service';
import {
  useDashboardAnalytics,
  type DashboardTimeRange,
} from '../../../backend/analytics.service';
import { MostPlayedGames } from './MostPlayedGames';
import { usePermissions } from '../../../hooks/usePermissions';
import UserActivityLog from '../Analytics/UserActivityLog';
import GameActivity from '../Analytics/GameActivity';
import { DonutChart } from '../../../components/charts/donutChart';
import HorizontalBarChart from '../../../components/charts/barChart';
import { UserTypeBreakdown } from '../../../components/charts/UserTypeBreakdown';
import { Navigate } from 'react-router-dom';
// import { RecentUserActivity } from './RecentUserActivity';

function DashboardContent() {
  const permissions = usePermissions();
  // Redirection logic moved to wrapper component

  const [isAcceptInviteOpen, setIsAcceptInviteOpen] = useState(false);
  const [statsTimeRange, setStatsTimeRange] = useState<DashboardTimeRange>({
    period: 'last24hours',
  });
  const [countryFilter, setCountryFilter] = useState<string[]>([]);
  const [timezoneFilter, setTimezoneFilter] = useState<string>('Europe/Nicosia');
  // Separate state for insights filter
  const [insightsTimeRange, setInsightsTimeRange] =
    useState<DashboardTimeRange>({ period: 'last30days' });

  const [barChartTimeRange, setBarChartTimeRange] =
    useState<DashboardTimeRange>({ period: 'last30days' });

  console.log('barchartTimeRange:', barChartTimeRange);

  const [registrationTimeRange, setRegistrationTimeRange] =
    useState<DashboardTimeRange>({ period: 'last30days' });

  const { data: analyticsData } = useSignupAnalyticsData();
  return (
    <div className="bg-[#F1F5F9] dark:bg-[#121C2D]">
      {/* stats cards */}
      <div className="px-6 pb-3">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            Dashboard
          </h1>
          {permissions.canFilter && (
            <div className="flex flex-col sm:flex-row gap-2">
              <DashboardTimeFilter
                value={statsTimeRange}
                onChange={setStatsTimeRange}
              />
              <DashboardCountryFilter
                value={countryFilter}
                onChange={setCountryFilter}
              />
              <DashboardTimezoneFilter
                value={timezoneFilter}
                onChange={setTimezoneFilter}
              />
            </div>
          )}
        </div>
      </div>
      <div className="px-6">
        <StatsCard
          filters={{ timeRange: statsTimeRange, countries: countryFilter, timezone: timezoneFilter }}
        />

        {/* Game activity */}
        <GameActivity filters={{ timeRange: statsTimeRange, countries: countryFilter, timezone: timezoneFilter }} />

        <div className="col-span-1 md:col-span-2 lg:col-span-4 mb-6 mt-6">
          <MostPlayedGames />
        </div>

        {/* insights */}
        <div className="col-span-1 md:col-span-2 lg:col-span-4 mb-2 mt-2">
          <Card className="bg-[#F1F5F9] dark:bg-[#121C2D] shadow-none border-none w-full">
            <div className="flex p-3 justify-between">
              <p className="text-lg sm:text-2xl">Click insights</p>
              <DashboardTimeFilter
                value={insightsTimeRange}
                onChange={setInsightsTimeRange}
              />
            </div>
            {/* inner card */}
            <Card className="bg-[#F8FAFC] dark:bg-[#0F1221] shadow-none border-none mx-3 p-3">
              <div className="flex flex-col">
                <div className="">
                  <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
                    <img
                      src={click}
                      alt="click"
                      className="w-8 h-6 sm:w-10 sm:h-6 dark:text-white flex-shrink-0"
                    />
                    <p className="text-sm sm:text-lg text-[#64748A] dark:text-white">
                      Total clicks on Sign-up button (
                      {analyticsData?.totalClicks})
                    </p>
                  </div>

                  <SignupClickInsights timeRange={insightsTimeRange} />
                </div>
              </div>
            </Card>
          </Card>
        </div>

        {/* bar chart - insights */}
        <div className="w-full mt-3">
          <Card className="bg-[#F1F5F9] dark:bg-[#121C2D] shadow-none border-none w-full">
            <div className="justify-between items-center flex p-3">
              <p className="text-base sm:text-xl lg:text-2xl">
                Click insights (Buttons)
              </p>
              <DashboardTimeFilter
                value={barChartTimeRange}
                onChange={setBarChartTimeRange}
              />
            </div>
            {/* inner card */}
            <Card className="bg-[#F8FAFC] dark:bg-[#0F1221] shadow-none border-none mx-3 p-3">
              <div className="flex flex-col space-y-2">
                <div className="">
                  <div className="justify-start flex items-center gap-4">
                    <img
                      src={click}
                      alt="users"
                      className="w-10 h-10 dark:text-white"
                    />
                    <p className="text-sm sm:text-base lg:text-lg text-[#64748A] dark:text-white">
                      Total clicks on Sign-up button (
                      {analyticsData?.totalClicks || 0})
                    </p>
                  </div>

                  <HorizontalBarChart timeRange={barChartTimeRange} />
                </div>
              </div>
            </Card>
          </Card>
        </div>

        {/* Registration insights donut chart */}
        <div className="w-full mt-3">
          <Card className="bg-[#F1F5F9] dark:bg-[#121C2D] shadow-none border-none w-full">
            <div className="justify-between items-center flex p-3">
              <p className="text-lg sm:text-xl lg:text-2xl">
                Registration insights
              </p>
              <DashboardTimeFilter
                value={registrationTimeRange}
                onChange={setRegistrationTimeRange}
              />
            </div>
            {/* inner card */}
            <Card className="bg-[#F8FAFC] dark:bg-[#0F1221] shadow-none border-none mx-3 p-2">
              <div className="flex flex-col space-y-2">
                <div className="">
                  <div className="justify-start flex items-center gap-4 font-worksans">
                    <img
                      src={usersLine}
                      alt="users"
                      className="w-10 h-10 dark:text-white"
                    />
                    <p className="text-sm sm:text-base lg:text-lg text-[#64748A] dark:text-white">
                      Total number of verified users
                    </p>
                  </div>

                  <DonutChart timeRange={registrationTimeRange} />
                </div>
              </div>
            </Card>
          </Card>
        </div>

        {/* User Type Breakdown */}
        <div className="w-full mt-3">
          <UserTypeBreakdown
            filters={{ timeRange: statsTimeRange, countries: countryFilter }}
          />
        </div>

        {/* User activity log */}
        <UserActivityLog />

        {/* <div className="col-span-1 md:col-span-2 lg:col-span-4 mb-6">
          <RecentUserActivity />
        </div> */}
      </div>

      <AcceptInvitationModal
        open={isAcceptInviteOpen}
        onOpenChange={setIsAcceptInviteOpen}
        isExistingUser={true}
      />
    </div>
  );
}

export default function Home() {
  const permissions = usePermissions();

  // If user is Editor (can manage games but not view analytics), redirect to game management
  if (!permissions.canViewAnalytics && permissions.canManageGames) {
    return <Navigate to="/admin/game-management" replace />;
  }

  return <DashboardContent />;
}

// Separate component for signup click insights
function SignupClickInsights({ timeRange }: { timeRange: DashboardTimeRange }) {
  const filters = { timeRange };
  const { data: signupAnalytics, isLoading: analyticsLoading } =
    useSignupAnalyticsData(filters);
  const { data: dashboardAnalytics, isLoading: usersLoading } =
    useDashboardAnalytics(filters);

  if (analyticsLoading || usersLoading) {
    return <div className="text-center py-4">Loading...</div>;
  }

  if (!signupAnalytics || !dashboardAnalytics) {
    return <div className="text-center py-4">No data available</div>;
  }

  const registeredInPeriod =
    dashboardAnalytics?.totalRegisteredUsers?.current || 0;

  const totalClicks = signupAnalytics?.periodClicks || 0;
  const verifiedCount = registeredInPeriod;
  const didntVerifyCount = Math.max(0, totalClicks - verifiedCount);

  const chartData = [
    { name: "Didn't verify", value: didntVerifyCount, fill: '#64748A' },
    { name: 'Verified users', value: verifiedCount, fill: '#D1D5DB' },
  ];

  return <PieChart data={chartData} totalClicks={totalClicks} />;
}
