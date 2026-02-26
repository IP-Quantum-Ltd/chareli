# Analytics System Deep Dive Analysis

## Executive Summary

This codebase implements a comprehensive analytics system that tracks user behavior, gameplay metrics, and engagement patterns. The system supports both authenticated users and anonymous visitors, with sophisticated data collection, processing, and visualization capabilities.

---

## Table of Contents

1. [Analytics Architecture Overview](#analytics-architecture-overview)
2. [What Analytics Are Measured](#what-analytics-are-measured)
3. [How Analytics Are Measured](#how-analytics-are-measured)
4. [How Analytics Are Displayed](#how-analytics-are-displayed)
5. [Data Flow and Processing](#data-flow-and-processing)
6. [Technical Implementation Details](#technical-implementation-details)
7. [Performance Optimizations](#performance-optimizations)
8. [Data Storage and Schema](#data-storage-and-schema)

---

## Analytics Architecture Overview

The analytics system follows a **multi-layered architecture**:

1. **Client-Side Tracking Layer**: React components and utilities that capture user interactions
2. **API Layer**: REST endpoints that receive and validate analytics data
3. **Queue Processing Layer**: Asynchronous job processing using BullMQ (Redis-based)
4. **Database Layer**: PostgreSQL with TypeORM for persistent storage
5. **Caching Layer**: Redis for performance optimization
6. **Visualization Layer**: React components displaying analytics dashboards

### Key Technologies
- **Frontend**: React, TypeScript, React Query
- **Backend**: Node.js, Express, TypeORM
- **Queue System**: BullMQ with Redis
- **Database**: PostgreSQL (internal schema)
- **Caching**: Redis
- **External Analytics**: Cloudflare Zaraz (Google Analytics integration)

---

## What Analytics Are Measured

### 1. User Activity Analytics

#### 1.1 Homepage Visits
- **What**: Tracks when users (authenticated or anonymous) land on the homepage
- **Activity Type**: `homepage_visit`
- **Data Captured**:
  - User ID (if authenticated) or Session ID (if anonymous)
  - Timestamp
  - Duration: 0 seconds (instantaneous event)

#### 1.2 Game Sessions
- **What**: Tracks gameplay sessions with detailed metrics
- **Activity Types**: Various game-related activities
- **Data Captured**:
  - Game ID
  - Start time
  - End time
  - Duration (in seconds)
  - Session count
  - User ID or Session ID

**Minimum Duration Threshold**: Game sessions must be **30+ seconds** to be recorded. Sessions shorter than 30 seconds are automatically deleted.

#### 1.3 User Authentication Events
- **What**: Tracks login and signup activities
- **Activity Types**: `login`, `signup`
- **Data Captured**: User ID, timestamps, session information

### 2. Signup Analytics (Separate Entity)

#### 2.1 Signup Button Clicks
- **What**: Tracks clicks on signup buttons across different locations
- **Data Captured**:
  - Session ID
  - IP Address
  - Country (derived from IP)
  - Device Type (mobile, tablet, desktop)
  - Signup Form Type (e.g., 'homepage', 'navbar', 'popup', 'signup-modal')
  - Timestamp

**Exclusion Logic**: `signup-modal` type is excluded from total counts to avoid double-counting.

#### 2.2 Signup Click Breakdowns
- Clicks by country
- Clicks by device type
- Clicks by day (time series)
- Clicks by form type/location
- Unique sessions

### 3. Game Performance Analytics

#### 3.1 Game Click Tracking
- **What**: Tracks when users click on games (position-based)
- **Data Captured**:
  - Game ID
  - Position (where the game appears)
  - Click count per position
  - Timestamp

#### 3.2 Game Session Metrics
- **What**: Aggregated metrics per game
- **Metrics**:
  - Unique players
  - Total sessions
  - Total play time
  - Average session duration
  - Most played position

### 4. Dashboard Metrics (Aggregated)

#### 4.1 User Metrics
- **Daily Active Users (DAU)**: Users who played games for 30+ seconds in last 24 hours
- **Daily Anonymous Visitors (DAV)**: Anonymous users with 30+ second sessions in last 24 hours
- **Total Visitors**: Unique visitors (authenticated + anonymous) who landed on homepage or played games
- **Total Active Users**: Users with analytics records in selected period
- **Total Registered Users**: New registrations in period
- **Active/Inactive Users**: Breakdown of registered users by activity status
- **Adults/Minors Count**: Age group breakdown

#### 4.2 Engagement Metrics
- **Total Sessions**: All game sessions (30+ seconds) in period
- **Anonymous Sessions**: Anonymous user sessions
- **Total Time Played**: Sum of all session durations (in seconds)
- **Anonymous Time Played**: Anonymous user play time
- **Average Session Duration**: Mean session length
- **User Type Breakdown**: Authenticated vs Anonymous (sessions and time)

#### 4.3 Game Metrics
- **Game Coverage**: Percentage of total games that have been played
- **Most Played Games**: Top 3 games by session count
- **Best Performing Games**: Games ranked by total play time and sessions

#### 4.4 Retention Metrics
- **Retention Rate**: Percentage of users who played yesterday and also played today
- **Calculation**: (Returning users / Previous day users) × 100

### 5. External Analytics Integration

#### 5.1 Google Analytics (via Cloudflare Zaraz)
- **What**: Client-side event tracking sent to Google Analytics
- **Events Tracked**:
  - `game_start`: When a game session begins
  - `game_end`: When a game session ends
  - `game_milestone`: Duration milestones during gameplay
  - `game_loaded`: Game load time tracking
  - `game_exit`: Early game exits
  - `game_share`: Game sharing events
  - `game_click`: Game thumbnail clicks
  - `see_more_games`: Pagination/interaction events

**Event Parameters**:
- `game_id`: Game identifier
- `game_title`: Game name
- `duration`: Session duration in seconds
- `load_time`: Load time in milliseconds
- `event_category`: Event categorization
- `event_label`: Descriptive label

---

## How Analytics Are Measured

### 1. Client-Side Tracking

#### 1.1 Homepage Visit Tracking
**Location**: `Client/src/layout/RootLayout.tsx`

**Implementation**:
```typescript
// Tracks page visits on route changes
useEffect(() => {
  const trackPageVisit = async () => {
    // Get or create visitor session ID
    let sessionId = sessionStorage.getItem('visitor_session_id');
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem('visitor_session_id', sessionId);
    }

    // POST to /api/analytics/homepage-visit
    fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ sessionId }),
      keepalive: true, // Ensures completion during page unload
    });
  };
  trackPageVisit();
}, [location]);
```

**Key Features**:
- Session ID stored in `sessionStorage`
- Tracks on every route change
- Uses `keepalive: true` for reliability
- Supports both authenticated and anonymous users

#### 1.2 Game Session Tracking
**Location**: `Client/src/pages/GamePlay/GamePlay.tsx`

**Implementation Flow**:
1. **Game Load Start**: Records timestamp when game starts loading
2. **Game Load Complete**: Calculates load time, creates analytics entry
3. **Game Start**: Records start time, sends `game_start` to Google Analytics
4. **Milestone Tracking**: Tracks duration milestones (e.g., 1min, 5min, 10min)
5. **Game End**: Records end time, calculates duration, updates analytics

**Code Pattern**:
```typescript
// Create analytics entry on game load
const startTime = new Date();
createAnalytics({
  gameId: game.id,
  activityType: 'game_session',
  startTime: startTime.toISOString(),
  sessionId: getVisitorSessionId(),
});

// Update analytics on game end
updateAnalytics({
  id: analyticsId,
  endTime: new Date().toISOString(),
});
```

**Milestone Tracking**:
- Tracks milestones at: 30s, 60s, 300s, 600s (30sec, 1min, 5min, 10min)
- Prevents duplicate milestone events using Set
- Sends to Google Analytics via Zaraz

#### 1.3 Signup Click Tracking
**Location**: `Client/src/components/modals/SignUpModal.tsx` and other signup locations

**Implementation**:
```typescript
// Track signup button click
useTrackSignupClick().mutate({
  sessionId: getVisitorSessionId(),
  type: 'homepage' | 'navbar' | 'popup' | 'signup-modal',
});
```

**Device Detection**: Server-side detection from User-Agent header

#### 1.4 Game Click Tracking
**Location**: `Client/src/hooks/useGameClickHandler.ts`

**Implementation**:
- Uses `navigator.sendBeacon()` for production (reliable during navigation)
- Falls back to regular `fetch()` in development
- Also tracks to Google Analytics via Zaraz
- Records position-based clicks via `/api/game-position-history/:gameId/click`

### 2. Server-Side Processing

#### 2.1 Queue-Based Processing
**Architecture**: All analytics writes go through BullMQ job queues

**Queue Types**:
- `analytics-processing`: Main analytics events
- `homepage-visit`: Homepage visit tracking
- `click-tracking`: Game click tracking

**Benefits**:
- Non-blocking: User experience not affected by analytics processing
- Retry logic: Failed jobs automatically retry (3 attempts)
- Scalability: Handles high concurrent load (50 concurrent workers)
- Reliability: Jobs persist in Redis

**Queue Configuration**:
```typescript
{
  removeOnComplete: 100,  // Keep last 100 completed jobs
  removeOnFail: 200,      // Keep last 200 failed jobs
  attempts: 3,            // Retry failed jobs 3 times
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
}
```

#### 2.2 Admin User Exclusion
**Multi-Layer Protection**:
1. **Controller Level**: Checks user role before queueing
2. **Worker Level**: Validates role before saving
3. **Query Level**: Filters admin users from all analytics queries

**Excluded Roles**: `superadmin`, `admin`, `editor`, `viewer`

**Implementation**:
```typescript
// Worker checks role before saving
const adminRoles = ['superadmin', 'admin', 'editor', 'viewer'];
if (user && user.role && adminRoles.includes(user.role.name)) {
  return { success: true, analyticsId: 'admin-excluded' };
}
```

#### 2.3 Duration Calculation
**Automatic Calculation**: Duration calculated in entity hooks

**Location**: `Server/src/entities/Analytics.ts`

```typescript
@BeforeInsert()
@BeforeUpdate()
calculateDuration() {
  if (this.startTime && this.endTime) {
    this.duration = Math.floor(
      (this.endTime.getTime() - this.startTime.getTime()) / 1000
    );
  }
}
```

**Minimum Duration Filter**: Game sessions < 30 seconds are deleted

### 3. Data Aggregation

#### 3.1 Dashboard Analytics Calculation
**Location**: `Server/src/controllers/adminDashboardController.ts`

**Time Period Support**:
- `last24hours`: Last 24 hours
- `last7days`: Last 7 days
- `last30days`: Last 30 days
- `custom`: Custom date range

**Timezone Awareness**: All calculations respect user's timezone for proper day boundaries

**Key Queries**:
1. **Unique User Counting**: Uses `COALESCE(CAST(userId AS VARCHAR), sessionId)` to count both authenticated and anonymous users
2. **Retention Calculation**: Compares users from previous period to current period
3. **Percentage Changes**: Calculates change from previous period (capped at ±100%)

#### 3.2 Caching Strategy
**Cache Keys**: Include period, countries, and timezone
**TTL**: 5 minutes (300 seconds) for dashboard analytics (default cache TTL)
**Cache Location**: Redis via `cacheService`

**Cache Invalidation**: Triggered on:
- New analytics creation
- Analytics updates
- Analytics deletions

---

## How Analytics Are Displayed

### 1. Admin Dashboard

#### 1.1 Main Dashboard (`/admin/home`)
**Location**: `Client/src/pages/Admin/Home/Home.tsx`

**Components**:
- **StatsCard**: Main metrics display
- **GameActivity**: Game activity charts
- **MostPlayedGames**: Top games widget
- **SignupClickInsights**: Signup analytics charts

#### 1.2 StatsCard Component
**Location**: `Client/src/pages/Admin/Home/StatsCard.tsx`

**Displayed Metrics** (in order):

1. **Total Unique Visitors**
   - Value: Total visitors (authenticated + anonymous)
   - Change: Percentage change from previous period
   - Description: "Users landed on homepage"
   - Tooltip: Includes page visits and game sessions

2. **Total Unique Players**
   - Value: Users who started a game
   - Change: Percentage change
   - Description: "Users who started a game"
   - Tooltip: 30+ second sessions only

3. **Daily Active Players**
   - Value: DAU count
   - Change: "24h only" (static)
   - Description: "Always last 24 hours"
   - Tooltip: Rolling 24-hour window

4. **Best Performing Games**
   - Value: Top 3 games list
   - Change: Overall percentage change
   - Description: Time range description
   - Tooltip: Ranked by session count

5. **Game Coverage**
   - Value: Percentage
   - Change: Percentage change
   - Description: Time range
   - Tooltip: % of games played at least once

6. **Total Game Sessions**
   - Value: Session count
   - Change: Percentage change
   - Description: Time range
   - Tooltip: 30+ second sessions

7. **Total Gameplay Time**
   - Value: Formatted time (hours/minutes)
   - Change: Percentage change
   - Description: Time range
   - Tooltip: Sum of all session durations

8. **Average Session Time**
   - Value: Formatted time
   - Change: Percentage change
   - Description: Time range
   - Tooltip: Mean session duration

**Authenticated-Only Metrics**:
- **New Registered Users**: Registration count with change
- **Retention Rate**: Percentage with tooltip
- **Active/Inactive Users**: Breakdown counts

**Visual Features**:
- Icons for each metric (Users, Clock, Star, etc.)
- Color-coded change indicators (green up, red down)
- Tooltips with detailed explanations
- Responsive grid layout

#### 1.3 Game Activity Component
**Location**: `Client/src/pages/Admin/Analytics/GameActivity.tsx`

**Displays**:
- Game activity over time (line chart)
- Filterable by time range, countries, timezone
- Shows sessions, play time, unique players

#### 1.4 Most Played Games Component
**Location**: `Client/src/pages/Admin/Home/MostPlayedGames.tsx`

**Displays**:
- Top games with thumbnails
- Session counts
- Percentage changes
- Clickable to view game details

#### 1.5 Signup Click Insights
**Location**: `Client/src/components/charts/barChart.tsx` (used for signup analytics)

**Displays**:
- Total clicks count
- Clicks over time (bar chart)
- Filterable by time range

### 2. Analytics Page (`/admin/analytics`)
**Location**: `Client/src/pages/Admin/Analytics/Analytics.tsx`

**Currently Displays**:
- Signup analytics data
- (Some components commented out: User Age chart, User Activity Log, Game Activity)

### 3. User Activity Log
**Location**: `Client/src/pages/Admin/Analytics/UserActivityLog.tsx`

**Displays**:
- One entry per user
- Latest activity type
- Last game played
- Session duration
- Online/Offline status
- Filterable by: date range, user status, user name, game title, activity type

### 4. Game Analytics View
**Location**: `Client/src/pages/Admin/ViewGame.tsx`

**Displays** (per game):
- Unique players
- Total sessions
- Total play time
- Average session duration
- Top players (top 10)
- Daily play time trends

### 5. User Analytics View
**Location**: `Client/src/pages/Admin/UserMgtView.tsx`

**Displays** (per user):
- Total games played
- Total session count
- Total time played
- Game activity breakdown (per game)
- Most played game

### 6. Charts and Visualizations

#### 6.1 User Type Breakdown
**Location**: `Client/src/components/charts/UserTypeBreakdown.tsx`

**Displays**:
- Donut chart showing authenticated vs anonymous
- Breakdown by sessions and time played
- Percentages for each category

#### 6.2 Donut Chart
**Location**: `Client/src/components/charts/donutChart.tsx`

**Used For**:
- Registration insights
- User type breakdowns
- Other categorical data

#### 6.3 Bar Chart
**Location**: `Client/src/components/charts/barChart.tsx`

**Used For**:
- Signup click insights over time
- Time series data

### 7. Filtering and Time Range Selection

#### 7.1 Dashboard Time Filter
**Location**: `Client/src/components/single/DashboardTimeFilter.tsx`

**Options**:
- Last 24 hours
- Last 7 days
- Last 30 days
- Custom date range

**Features**:
- Timezone selection
- Country filtering (multi-select)
- Applied to all dashboard metrics

---

## Data Flow and Processing

### 1. Analytics Event Flow

```
User Action (Client)
    ↓
React Component/Utility
    ↓
API Endpoint (POST /api/analytics)
    ↓
Controller Validation
    ↓
Queue Service (BullMQ)
    ↓
Redis Queue
    ↓
Worker Process
    ↓
Database (PostgreSQL)
    ↓
Cache Invalidation
    ↓
Dashboard Update (on next query)
```

### 2. Homepage Visit Flow

```
Page Load/Route Change
    ↓
RootLayout useEffect
    ↓
POST /api/analytics/homepage-visit
    ↓
Controller (checks admin exclusion)
    ↓
Queue: homepage-visit
    ↓
Worker: homepageVisit.worker.ts
    ↓
Database: Analytics table
```

### 3. Game Session Flow

```
Game Load Start
    ↓
Record load start time
    ↓
Game Load Complete
    ↓
Create Analytics Entry (queue)
    ↓
Game Start
    ↓
Track to Google Analytics (Zaraz)
    ↓
Milestone Tracking (periodic)
    ↓
Game End / Page Unload
    ↓
Update Analytics Entry (endTime)
    ↓
Calculate Duration
    ↓
Delete if < 30 seconds
```

### 4. Dashboard Query Flow

```
Admin Dashboard Load
    ↓
React Query Hook (useDashboardAnalytics)
    ↓
Check Cache (Redis)
    ↓
If Cache Hit: Return cached data
    ↓
If Cache Miss:
    ↓
API: GET /api/admin/dashboard
    ↓
Controller: adminDashboardController.ts
    ↓
Multiple Database Queries (parallel)
    ↓
Aggregate Results
    ↓
Cache Result (5 min TTL)
    ↓
Return to Frontend
    ↓
Display in StatsCard Component
```

---

## Technical Implementation Details

### 1. Database Schema

#### Analytics Table
**Schema**: `internal.analytics`
**Entity**: `Server/src/entities/Analytics.ts`

**Columns**:
- `id`: UUID (Primary Key)
- `user_id`: UUID (nullable, indexed)
- `session_id`: VARCHAR(255) (nullable, indexed)
- `game_id`: UUID (nullable, indexed)
- `activity_type`: VARCHAR(50) (indexed)
- `start_time`: TIMESTAMP (nullable, indexed)
- `end_time`: TIMESTAMP (nullable, indexed)
- `duration`: INTEGER (nullable, indexed) - seconds
- `session_count`: INTEGER (nullable)
- `created_at`: TIMESTAMP (indexed)
- `updated_at`: TIMESTAMP

**Indexes**:
- Single column indexes on: `user_id`, `session_id`, `game_id`, `activity_type`, `start_time`, `created_at`, `duration`
- Composite indexes for optimized queries:
  - `(createdAt, userId, sessionId, duration)` - For unified user counting
  - `(createdAt, gameId, duration)` - For game session queries
  - `(createdAt, duration)` - For time-range filtered queries

#### SignupAnalytics Table
**Schema**: `internal.signup_analytics`
**Entity**: `Server/src/entities/SignupAnalytics.ts`

**Columns**:
- `id`: UUID (Primary Key)
- `session_id`: VARCHAR (nullable, indexed)
- `ip_address`: VARCHAR (nullable)
- `country`: VARCHAR (nullable, indexed)
- `device_type`: VARCHAR (nullable, indexed) - 'mobile', 'tablet', 'desktop'
- `type`: VARCHAR (indexed) - Signup form type
- `created_at`: TIMESTAMP (indexed)

### 2. API Endpoints

#### Analytics Endpoints
- `POST /api/analytics` - Create analytics entry
- `GET /api/analytics` - Get all analytics (with filters)
- `GET /api/analytics/:id` - Get analytics by ID
- `PUT /api/analytics/:id` - Update analytics entry
- `DELETE /api/analytics/:id` - Delete analytics entry
- `POST /api/analytics/:id/end` - Update end time (for page unload)
- `POST /api/analytics/homepage-visit` - Track homepage visit

#### Admin Dashboard Endpoints
- `GET /api/admin/dashboard` - Get dashboard analytics
- `GET /api/admin/user-activity-log` - Get user activity log
- `GET /api/admin/games-analytics` - Get games with analytics
- `GET /api/admin/games/:id/analytics` - Get game-specific analytics
- `GET /api/admin/users/:id/analytics` - Get user-specific analytics
- `GET /api/admin/users-analytics` - Get all users with analytics
- `GET /api/admin/games-popularity` - Get games popularity metrics

#### Signup Analytics Endpoints
- `POST /api/signup-analytics/click` - Track signup click
- `GET /api/signup-analytics/data` - Get signup analytics data

### 3. Rate Limiting

**Location**: `Server/src/middlewares/rateLimitMiddleware.ts`

**Analytics Limiter**:
- **Window**: 1 minute
- **Max Requests**: 500 per session/user per minute
- **Key Generator**: userId > sessionId > IP (priority order)
- **Store**: Redis
- **Skip Conditions**:
  - Development/test environments
  - Redis down (graceful degradation)

### 4. Error Handling

**Client-Side**:
- Analytics failures don't block user experience
- Errors logged to console (development only)
- Fallback mechanisms (e.g., sendBeacon → fetch)

**Server-Side**:
- Queue retry logic (3 attempts with exponential backoff)
- Admin exclusion handled gracefully
- Failed jobs logged for debugging

---

## Performance Optimizations

### 1. Database Optimizations

#### Indexes
- **Comprehensive Indexing**: All frequently queried columns indexed
- **Composite Indexes**: Optimized for common query patterns
- **Query Optimization**: Uses `COALESCE` for unified user counting

#### Query Optimizations
- **Batch Queries**: User activity log uses window functions for batch processing
- **Parallel Queries**: Dashboard metrics calculated in parallel using `Promise.all()`
- **Efficient Joins**: Left joins with proper filtering

### 2. Caching Strategy

#### Cache Layers
1. **Redis Cache**: Dashboard analytics cached for 5 minutes (300 seconds, default TTL)
2. **React Query Cache**: Client-side caching with automatic invalidation
3. **Cache Keys**: Include all filter parameters (period, countries, timezone)

#### Cache Invalidation
- Automatic invalidation on analytics mutations
- Query key-based invalidation
- Time-based expiration (TTL)

### 3. Queue Processing

#### Concurrency
- **Worker Concurrency**: 50 concurrent jobs per worker
- **Queue Separation**: Different queues for different job types
- **Priority Handling**: Jobs processed in order

#### Monitoring
- Queue statistics logged every 30 seconds
- Job duration tracking
- Failure rate monitoring

### 4. Client-Side Optimizations

#### Lazy Loading
- Components loaded on demand
- Code splitting for analytics components

#### Request Optimization
- `keepalive: true` for reliable page unload tracking
- `sendBeacon` for production click tracking
- Batch invalidation of React Query cache

---

## Data Storage and Schema

### Analytics Data Model

**Primary Entity**: `Analytics`
- Supports both authenticated (`userId`) and anonymous (`sessionId`) tracking
- Links to `User` and `Game` entities via foreign keys
- Automatic duration calculation via entity hooks

**Activity Types**:
- `homepage_visit`: Homepage landing
- `game_session`: Gameplay session
- `login`: User login
- `signup`: User registration
- (Custom activity types can be added)

### Signup Analytics Data Model

**Primary Entity**: `SignupAnalytics`
- Tracks signup button clicks
- Includes geographic and device information
- Supports multiple signup form types

### Data Retention

**Analytics Records**:
- Stored indefinitely (no automatic deletion)
- Can be manually cleared via scripts
- Indexed for fast queries even with large datasets

**Queue Jobs**:
- Completed: Last 100 kept
- Failed: Last 200 kept (for debugging)

### Data Privacy

**Admin Exclusion**:
- Admin users completely excluded from analytics
- Triple-layer protection (controller, worker, query)
- No admin activity data stored

**Anonymous Tracking**:
- Uses session IDs (not cookies)
- Stored in `sessionStorage` (cleared on browser close)
- No PII collected for anonymous users

---

## Summary

This analytics system provides:

1. **Comprehensive Tracking**: User behavior, gameplay, engagement, and conversions
2. **Scalable Architecture**: Queue-based processing handles high load
3. **Real-time Dashboards**: Cached, filterable analytics views
4. **Performance Optimized**: Indexes, caching, and efficient queries
5. **Privacy Compliant**: Admin exclusion and anonymous tracking support
6. **External Integration**: Google Analytics via Cloudflare Zaraz
7. **Flexible Filtering**: Time ranges, countries, timezones
8. **Detailed Metrics**: User, game, session, and engagement analytics

The system is production-ready, handles both authenticated and anonymous users, and provides actionable insights through well-designed dashboards.
