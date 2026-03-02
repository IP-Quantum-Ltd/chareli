/* eslint-disable @typescript-eslint/no-explicit-any */
import { Clock, Star, Hourglass, CalendarClock, Users, ArrowUp, ArrowDown } from 'lucide-react';
import {
  useDashboardAnalytics,
  type DashboardFilters,
} from '../../../backend/analytics.service';
import { Card } from '../../../components/ui/card';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '../../../components/ui/tooltip';
import { Info } from 'lucide-react';

import { formatTime } from '../../../utils/main';

interface StatsCardProps {
  filters?: DashboardFilters;
}

export default function StatsCard({ filters }: StatsCardProps) {
  const {
    data: dashboardAnalytics,
    isError,
    isLoading,
  } = useDashboardAnalytics(filters);

  if (isLoading) {
    return (
      <div className="col-span-1 md:col-span-2 lg:col-span-4 mt-4">
        <Card className="bg-[#F1F5F9] dark:bg-[#121C2D] shadow-none border-none w-full">
          <div className="p-4">Loading dashboard data...</div>
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="col-span-1 md:col-span-2 lg:col-span-4 mt-4">
        <Card className="bg-[#F1F5F9] dark:bg-[#121C2D] shadow-none border-none w-full">
          <div className="p-4 text-red-500">Error loading dashboard data</div>
        </Card>
      </div>
    );
  }

  const data = dashboardAnalytics as any;

  // Generate dynamic description based on time range
  const getTimeRangeDescription = () => {
    const timeRange = filters?.timeRange;
    switch (timeRange?.period) {
      case 'last7days':
        return 'Over the last 7 days';
      case 'last30days':
        return 'Over the last 30 days';
      case 'custom':
        if (timeRange.startDate) {
          const start = new Date(timeRange.startDate).toLocaleDateString();
          if (timeRange.endDate) {
            const end = new Date(timeRange.endDate).toLocaleDateString();
            return `From ${start} to ${end}`;
          } else {
            return `From ${start} to present`;
          }
        }
        return 'Custom date range';
      default:
        return 'Over the last 24 hours';
    }
  };

  const timeDescription = getTimeRangeDescription();

  // Metrics ordered as required:
  // 1. Total Users Landed on Homepage
  // 2. Total Unique Users Who Started a Game Session
  // 3. Total Sessions (gameplay hits)
  // 4. Total Gameplay Time (hours for >60 min)
  // 5. Best Performing Games
  // 6. Game Coverage
  // 7. Retention
  // ========== ALL USERS SECTION ==========
  // Metrics that include both authenticated + guest data
  const allUsersCards = [
    {
      title: 'Total Unique Visitors',
      value: data.totalVisitors.current,
      icon: <Users size={32} />,
      change: `${data.totalVisitors.percentageChange ?? 0}%`,
      changeType: data.totalVisitors.percentageChange >= 0 ? 'up' : 'down',
      description: 'Users landed on homepage',
      color: 'text-[#64748A] dark:text-white',
      tooltip:
        'Unique visitors who landed on the site (authenticated + guest). Counts anyone with a page visit or game session.',
    },
    {
      title: 'Total Unique Players',
      value: data.totalActiveUsers.current,
      icon: <Users size={32} />,
      change: `${data.totalActiveUsers.percentageChange ?? 0}%`,
      changeType: data.totalActiveUsers.percentageChange >= 0 ? 'up' : 'down',
      description: 'Users who started a game',
      color: 'text-[#64748A] dark:text-white',
      tooltip:
        'Unique users who played at least one game for 30+ seconds. Includes authenticated and guest users.',
    },
    {
      title: 'Daily Active Players',
      value: data.dailyActiveUsers.current,
      icon: <Users size={32} />,
      change: '24h only',
      changeType: 'up',
      description: 'Always last 24 hours',
      color: 'text-[#64748A] dark:text-white',
      isStatic: true,
      tooltip:
        'Unique users who played 30+ second games in the last 24 hours (rolling). Includes authenticated and guest users.',
    },
    {
      title: 'Best Performing Games',
      value:
        data.mostPlayedGames?.games?.length > 0
          ? data.mostPlayedGames.games
          : 'No games played',
      icon: <Star size={32} />,
      change: `${data.mostPlayedGames?.percentageChange ?? 0}%`,
      changeType:
        (data.mostPlayedGames?.percentageChange ?? 0) >= 0 ? 'up' : 'down',
      description: timeDescription,
      color: 'text-[#64748A] dark:text-white',
      isGamesList: true,
      tooltip:
        'Top 3 games ranked by number of sessions. Includes both authenticated and guest sessions.',
    },
    {
      title: 'Game Coverage',
      value: `${data.gameCoverage.current}%`,
      icon: <Star size={32} />,
      change: `${data.gameCoverage.percentageChange ?? 0}%`,
      changeType: data.gameCoverage.percentageChange >= 0 ? 'up' : 'down',
      description: timeDescription,
      color: 'text-[#64748A] dark:text-white',
      tooltip:
        'Percentage of total games that were played at least once in the period.',
    },
    {
      title: 'Total Game Sessions',
      value: data.totalSessions.current,
      icon: <CalendarClock size={36} />,
      change: `${data.totalSessions.percentageChange ?? 0}%`,
      changeType: data.totalSessions.percentageChange >= 0 ? 'up' : 'down',
      description: timeDescription,
      color: 'text-[#64748A] dark:text-white',
      tooltip:
        'Total number of 30+ second game sessions. Includes both authenticated and guest users.',
    },
    {
      title: 'Total Gameplay Time',
      value: formatTime(data.totalTimePlayed.current),
      icon: <Clock size={32} className="dark:text-white" />,
      change: `${data.totalTimePlayed.percentageChange ?? 0}%`,
      changeType: data.totalTimePlayed.percentageChange >= 0 ? 'up' : 'down',
      description: timeDescription,
      color: 'text-[#64748A] dark:text-white',
      tooltip:
        'Sum of all 30+ second game session durations. Includes both authenticated and guest users.',
    },
    {
      title: 'Average Session Time',
      value: formatTime(data.avgSessionDuration.current),
      icon: <Hourglass size={32} />,
      change: `${data.avgSessionDuration.percentageChange ?? 0}%`,
      changeType: data.avgSessionDuration.percentageChange >= 0 ? 'up' : 'down',
      description: timeDescription,
      color: 'text-[#64748A] dark:text-white',
      tooltip:
        'Average duration of 30+ second game sessions. Includes both authenticated and guest users.',
    },
  ];

  // ========== AUTHENTICATED ONLY SECTION ==========
  // Metrics for logged-in users only
  const authenticatedCards = [
    {
      title: 'New Registered Users',
      value: data.totalRegisteredUsers.current,
      icon: <Users size={32} />,
      change: `${data.totalRegisteredUsers.percentageChange ?? 0}%`,
      changeType:
        data.totalRegisteredUsers.percentageChange >= 0 ? 'up' : 'down',
      description: timeDescription,
      color: 'text-[#64748A] dark:text-white',
      tooltip:
        'Users who registered and completed first login in the selected period.',
    },
    {
      title: 'Retention Rate',
      value: `${Math.round(data.retentionRate) ?? 0}%`,
      icon: <CalendarClock size={36} />,
      change: '0%',
      changeType: 'up',
      description: 'Day-over-day retention',
      color: 'text-[#64748A] dark:text-white',
      tooltip:
        'Percentage of authenticated users from the previous period who returned in the current period.',
    },
  ];

  // ========== GUESTS ONLY SECTION ==========
  // Metrics for non-authenticated visitors
  const guestCards = [
    {
      title: 'Guest Sessions',
      value: data.anonymousSessions.current,
      icon: <CalendarClock size={36} />,
      change: `${data.anonymousSessions.percentageChange ?? 0}%`,
      changeType: data.anonymousSessions.percentageChange >= 0 ? 'up' : 'down',
      description: timeDescription,
      color: 'text-[#64748A] dark:text-white',
      tooltip:
        'Game sessions by visitors who are not logged in (30+ seconds). Uses session ID for identification.',
    },
    {
      title: 'Guest Time Played',
      value: formatTime(data.anonymousTimePlayed.current),
      icon: <Clock size={32} className="dark:text-white" />,
      change: `${data.anonymousTimePlayed.percentageChange ?? 0}%`,
      changeType:
        data.anonymousTimePlayed.percentageChange >= 0 ? 'up' : 'down',
      description: timeDescription,
      color: 'text-[#64748A] dark:text-white',
      tooltip:
        'Total playtime from guest (not logged in) visitors. Sessions must be 30+ seconds.',
    },
  ];

  // Helper function to render a card
  const renderCard = (card: any, idx: number) => (
    <div
      key={idx}
      className="dark:bg-[#334154] bg-[#F1F5F9] rounded-xl p-4"
    >
      <div className="tracking-widest h-full flex flex-col">
        {/* top */}
        <div className="flex justify-between mb-6">
          <div className="">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="font-semibold text-[#64748A] dark:text-white text-base cursor-help inline-flex items-center gap-1">
                  {card.title}
                  <Info size={14} className="text-gray-400" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[250px] bg-gray-800 text-white">
                {card.tooltip}
              </TooltipContent>
            </Tooltip>
            <div className={`font-bold text-xl ${card.color}`}>
              {card.isGamesList && Array.isArray(card.value) ? (
                <div className="space-y-1">
                  {card.value
                    .slice(0, 3)
                    .map((game: any, index: number) => {
                      const getRankIcon = (position: number) => {
                        switch (position) {
                          case 0:
                            return (
                              <span className="text-yellow-500">🥇</span>
                            );
                          case 1:
                            return (
                              <span className="text-gray-400">🥈</span>
                            );
                          case 2:
                            return (
                              <span className="text-amber-600">🥉</span>
                            );
                          default:
                            return (
                              <span className="text-xs opacity-75">
                                {position + 1}.
                              </span>
                            );
                        }
                      };

                      return (
                        <div
                          key={game.id || index}
                          className="text-sm font-medium leading-tight flex items-center gap-1"
                        >
                          {getRankIcon(index)}
                          <span className="truncate">{game.title}</span>
                        </div>
                      );
                    })}
                </div>
              ) : (
                card.value
              )}
            </div>
          </div>
          <span className="text-3xl text-[#64748A] dark:text-white">
            {card.icon}
          </span>
        </div>

        {/* bottom */}
        <div className="flex md:flex-1 justify-between items-center pr-2 gap-3 min-h-[32px]">
          <div
            className={`flex flex-row gap-1 items-center text-[14px] flex-shrink-0 ${
              card.changeType === 'up'
                ? 'text-white bg-[#475568] pl-1 pr-1 pt-1 pb-1 rounded-lg dark:bg-[#64748A]'
                : 'text-white bg-[#475568] dark:bg-[#64748A] pl-2 pr-2 pt-1 pb-1 rounded-lg'
            }`}
          >
            {card.changeType === 'up' ? (
              <ArrowUp />
            ) : (
              <ArrowDown />
            )}
            <span>{card.change}</span>
          </div>
          <div className="text-gray-400 text-[12px] font-worksans tracking-wider dark:text-white leading-tight text-right flex-shrink min-w-0 max-w-[140px] break-words">
            {card.description}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full space-y-6">
      {/* All Users Section */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Users size={20} />
          All Users
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {allUsersCards.map(renderCard)}
        </div>
      </div>

      {/* Authenticated Users Section */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Users size={20} />
          Authenticated Users
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {authenticatedCards.map(renderCard)}
        </div>
      </div>

      {/* Guest Visitors Section */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Users size={20} />
          Guest Visitors
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {guestCards.map(renderCard)}
        </div>
      </div>
    </div>
  );
}

