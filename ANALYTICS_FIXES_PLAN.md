# Analytics System Fixes - Implementation Plan

Comprehensive plan to address critical admin exclusion gaps, data collection issues, and data quality problems identified during analytics documentation verification.

## User Review Required

> [!WARNING]
> **Breaking Database Schema Changes**
>
> This implementation includes schema changes to the [SignupAnalytics](file:///home/kkfergie22/chareli/Server/src/entities/SignupAnalytics.ts#9-37) and [Analytics](file:///home/kkfergie22/chareli/Server/src/entities/Analytics.ts#16-90) entities:
> - Adding `userId` relationship to [SignupAnalytics](file:///home/kkfergie22/chareli/Server/src/entities/SignupAnalytics.ts#9-37) (requires migration)
> - Adding new columns (`exitReason`, `loadTime`) to [Analytics](file:///home/kkfergie22/chareli/Server/src/entities/Analytics.ts#16-90) (requires migration)
> - These migrations will need to be run on production databases

> [!IMPORTANT]
> **Admin Exclusion Priority**
>
> The critical admin exclusion fixes (Phase 1) should be deployed **immediately** as they directly impact data accuracy. Admin activities are currently being recorded in:
> - Login analytics (3 locations)
> - Signup analytics (3 locations)
> - Signup click analytics (1 location)
>
> This pollutes your analytics data and makes metrics unreliable.

> [!IMPORTANT]
> **Session ID Management Changes**
>
> We will consolidate session ID handling which may temporarily affect anonymous user tracking consistency during the transition. Session IDs will be cleared on login to prevent cross-contamination between anonymous and authenticated sessions.

---

## Proposed Changes

### Phase 1: Critical Admin Exclusion Fixes (HIGH PRIORITY)

**Goal:** Prevent admin activities from being recorded in analytics across all entry points.

> [!NOTE]
> **Reference Documents**
>
> This phase addresses the gaps identified in:
> - [ADMIN_HOMEPAGE_VISIT_TRACKING_ISSUE.md](file:///home/kkfergie22/chareli/ADMIN_HOMEPAGE_VISIT_TRACKING_ISSUE.md) - Session ID persistence and race conditions
> - [COMPREHENSIVE_ADMIN_EXCLUSION_GAPS.md](file:///home/kkfergie22/chareli/COMPREHENSIVE_ADMIN_EXCLUSION_GAPS.md) - All 12 identified gaps
>
> The strategy focuses on:
> 1. **Direct database writes** (7 locations) - Add admin checks before `.save()`
> 2. **Session ID cleanup** - Clear on login to prevent cross-contamination
> 3. **Unified session management** - One session ID key across all components

#### [MODIFY] [authController.ts](file:///home/kkfergie22/chareli/Server/src/controllers/authController.ts)

**Login Analytics Admin Exclusion (3 locations)**

Add admin exclusion checks before saving login analytics at:
- Lines 277-280 (Google OAuth login success)
- Lines 308-311 (Email/password login success)
- Lines 469-472 (OTP verification login success)

**Changes:**
```typescript
// Before saving login analytics, check user role
const userWithRole = await User.findOne({
  where: { id: user.id },
  relations: ['role']
});

// Only track if user is a player (not admin/superadmin/editor/viewer)
if (userWithRole?.role?.name === 'player') {
  await Analytics.save({
    userId: user.id,
    activityType: ActivityType.LOGIN,
    // ... rest of analytics data
  });
}
```

**Signup Analytics Admin Exclusion (2 locations)**

Add admin exclusion checks before saving signup analytics at:
- Lines 98-101 (Google OAuth signup)
- Lines 200-205 (Email/password signup)

**Changes:**
```typescript
// After user creation, check if assigned role is player
if (newUser?.role?.name === 'player') {
  await SignupAnalytics.save({
    sessionId,
    type: 'google', // or 'email'
    // ... rest of analytics data
  });
}
```

---

#### [MODIFY] [userController.ts](file:///home/kkfergie22/chareli/Server/src/controllers/userController.ts)

**Signup Analytics Admin Exclusion (1 location)**

Add admin exclusion check before saving signup analytics at lines 392-395 (OTP verification signup).

**Changes:**
```typescript
// After user verification, check role
const userWithRole = await User.findOne({
  where: { id: user.id },
  relations: ['role']
});

if (userWithRole?.role?.name === 'player') {
  await SignupAnalytics.save({
    sessionId: req.body.sessionId,
    type: 'email',
    // ... rest of analytics data
  });
}
```

---

#### [MODIFY] [signupAnalyticsController.ts](file:///home/kkfergie22/chareli/Server/src/controllers/signupAnalyticsController.ts)

**Signup Click Admin Exclusion**

Add admin exclusion check in [trackSignupClick](file:///home/kkfergie22/chareli/Server/src/controllers/signupAnalyticsController.ts#62-131) endpoint (lines 90-130).

**Changes:**
```typescript
// In trackSignupClick, check if user is authenticated and admin
if (req.user) {
  const userWithRole = await User.findOne({
    where: { id: req.user.id },
    relations: ['role']
  });

  // Don't track signup clicks from admin users
  if (userWithRole?.role?.name !== 'player') {
    return res.status(200).json({
      message: 'Signup click not tracked (admin user)'
    });
  }
}

// Continue with existing tracking logic...
```

---

#### [MODIFY] [sessionUtils.ts](file:///home/kkfergie22/chareli/Client/src/utils/sessionUtils.ts)

**Consolidate Session ID Management**

Currently, the application uses two different session ID keys:
- `visitor_session_id` (used by [RootLayout.tsx](file:///home/kkfergie22/chareli/Client/src/layout/RootLayout.tsx), [GamePlay.tsx](file:///home/kkfergie22/chareli/Client/src/pages/GamePlay/GamePlay.tsx))
- `analytics_session_id` (used by [Home.tsx](file:///home/kkfergie22/chareli/Client/src/pages/Home/Home.tsx))

**Changes:**
- Standardize on `visitor_session_id` across all components
- Add function to clear session ID on login
- Export centralized session ID getter/setter

```typescript
const SESSION_ID_KEY = 'visitor_session_id';

export const getOrCreateSessionId = (): string => {
  let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
  }
  return sessionId;
};

export const clearSessionId = (): void => {
  sessionStorage.removeItem(SESSION_ID_KEY);
};

export const getSessionId = (): string | null => {
  return sessionStorage.getItem(SESSION_ID_KEY);
};
```

---

#### [MODIFY] [RootLayout.tsx](file:///home/kkfergie22/chareli/Client/src/layout/RootLayout.tsx)

**Clear Session ID on Login**

Add effect to clear session ID when user authenticates.

**Changes:**
```typescript
import { getOrCreateSessionId, clearSessionId } from '@/utils/sessionUtils';

// Add effect to clear session ID on login
useEffect(() => {
  if (user) {
    // User is authenticated, clear anonymous session ID
    clearSessionId();
  }
}, [user]);

// Update homepage tracking to use centralized session ID
useEffect(() => {
  // ... existing location tracking logic
  if (!hasTrackedRef.current) {
    const sessionId = user ? null : getOrCreateSessionId();
    // ... rest of tracking logic
  }
}, [location]);
```

---

#### [MODIFY] [Home.tsx](file:///home/kkfergie22/chareli/Client/src/pages/Home/Home.tsx)

**Remove Duplicate Session ID Logic**

Replace local session ID logic with centralized utility.

**Changes:**
```typescript
import { getOrCreateSessionId } from '@/utils/sessionUtils';

// Remove local session ID generation
// Replace with:
const sessionId = user ? null : getOrCreateSessionId();
```

---

#### [MODIFY] [GamePlay.tsx](file:///home/kkfergie22/chareli/Client/src/pages/GamePlay/GamePlay.tsx)

**Use Centralized Session ID**

Update to use centralized session ID utility.

**Changes:**
```typescript
import { getOrCreateSessionId } from '@/utils/sessionUtils';

// Replace session ID logic with:
const sessionId = user ? null : getOrCreateSessionId();
```

---

### Phase 2: Data Collection Improvements (MEDIUM PRIORITY)

**Goal:** Store all tracked metrics in the internal database (exit reasons, load times, milestones).

#### [MODIFY] [Analytics.ts](file:///home/kkfergie22/chareli/Server/src/entities/Analytics.ts)

**Add Missing Tracking Fields**

Add columns to capture exit reasons, load times, and milestone markers.

**Changes:**
```typescript
@Entity('analytics', { schema: 'internal' })
export class Analytics {
  // ... existing columns

  @Column({ type: 'varchar', length: 50, nullable: true })
  exitReason?: string; // 'user_exit', 'error', 'completion', 'navigation'

  @Column({ type: 'integer', nullable: true })
  loadTime?: number; // Game load time in milliseconds

  @Column({ type: 'integer', nullable: true })
  milestone?: number; // Milestone reached (30, 60, 300, 600) in seconds

  @Column({ type: 'text', nullable: true })
  errorMessage?: string; // Error details if exitReason is 'error'
}
```

**Migration Required:** Yes - adds 4 new nullable columns

---

#### [MODIFY] [GamePlay.tsx](file:///home/kkfergie22/chareli/Client/src/pages/GamePlay/GamePlay.tsx)

**Store Exit Reasons and Load Times**

Update game session tracking to send exit reasons, load times, and milestones to the database.

**Changes:**
```typescript
// Track game load time
const handleIframeLoad = () => {
  const loadTime = Date.now() - gameStartTime;
  setIsLoading(false);

  // Send load time to database
  if (analyticsId) {
    fetch(`${API_URL}/api/analytics/${analyticsId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` })
      },
      body: JSON.stringify({ loadTime })
    }).catch(err => console.error('Failed to track load time:', err));
  }
};

// Track exit reason on cleanup
useEffect(() => {
  return () => {
    if (analyticsId && gameStartTime) {
      const exitReason = getExitReason(); // 'user_exit', 'navigation', etc.

      navigator.sendBeacon(
        `${API_URL}/api/analytics/${analyticsId}/end`,
        JSON.stringify({
          endTime: new Date().toISOString(),
          exitReason
        })
      );
    }
  };
}, [analyticsId, gameStartTime]);

// Track milestones to database
const trackMilestone = (seconds: number) => {
  if (analyticsId) {
    fetch(`${API_URL}/api/analytics/milestone`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` })
      },
      body: JSON.stringify({
        analyticsId,
        milestone: seconds
      })
    }).catch(err => console.error('Failed to track milestone:', err));
  }

  // Still send to Google Analytics
  zaraz.track('game_milestone', { /* ... */ });
};
```

---

#### [NEW] [milestoneController.ts](file:///home/kkfergie22/chareli/Server/src/controllers/milestoneController.ts)

**Create Milestone Tracking Endpoint**

New controller to handle milestone tracking separately from main analytics updates.

**Changes:**
```typescript
import { Request, Response } from 'express';
import { Analytics } from '../entities/Analytics';

export const trackMilestone = async (req: Request, res: Response) => {
  try {
    const { analyticsId, milestone } = req.body;

    if (!analyticsId || !milestone) {
      return res.status(400).json({
        message: 'analyticsId and milestone are required'
      });
    }

    // Create a separate milestone entry
    await Analytics.save({
      id: analyticsId,
      milestone,
      // Other fields remain unchanged
    });

    return res.status(200).json({
      message: 'Milestone tracked successfully'
    });
  } catch (error) {
    console.error('Error tracking milestone:', error);
    return res.status(500).json({
      message: 'Failed to track milestone'
    });
  }
};
```

---

#### [MODIFY] [analyticsController.ts](file:///home/kkfergie22/chareli/Server/src/controllers/analyticsController.ts)

**Update Analytics Endpoints**

Add support for new fields in update endpoints.

**Changes:**
```typescript
// In updateAnalytics
export const updateAnalytics = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { endTime, duration, loadTime, exitReason, errorMessage } = req.body;

    const analytics = await Analytics.findOne({ where: { id } });
    if (!analytics) {
      return res.status(404).json({ message: 'Analytics entry not found' });
    }

    // Update with new fields
    if (endTime) analytics.endTime = new Date(endTime);
    if (duration !== undefined) analytics.duration = duration;
    if (loadTime !== undefined) analytics.loadTime = loadTime;
    if (exitReason) analytics.exitReason = exitReason;
    if (errorMessage) analytics.errorMessage = errorMessage;

    // ... existing logic
  }
};
```

---

#### [MODIFY] [RootLayout.tsx](file:///home/kkfergie22/chareli/Client/src/layout/RootLayout.tsx)

**Add Client-Side Retry Logic**

Implement IndexedDB-based retry mechanism for failed analytics requests.

**Changes:**
```typescript
import { queueAnalyticsRequest } from '@/utils/analyticsQueue';

useEffect(() => {
  if (hasVisitedHomepage && !hasTrackedRef.current) {
    const sessionId = user ? null : getOrCreateSessionId();

    queueAnalyticsRequest({
      url: `${API_URL}/api/analytics/homepage-visit`,
      method: 'POST',
      body: { sessionId },
      token
    }).catch(err => console.error('Failed to queue analytics:', err));

    hasTrackedRef.current = true;
  }
}, [location, hasVisitedHomepage, user]);
```

---

#### [NEW] [analyticsQueue.ts](file:///home/kkfergie22/chareli/Client/src/utils/analyticsQueue.ts)

**Create Analytics Queue Utility**

New utility to handle failed analytics requests with retry logic using IndexedDB.

**Changes:**
```typescript
import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface AnalyticsRequest {
  id?: number;
  url: string;
  method: string;
  body: any;
  token?: string;
  retryCount: number;
  createdAt: number;
}

interface AnalyticsDB extends DBSchema {
  requests: {
    key: number;
    value: AnalyticsRequest;
    indexes: { 'by-created': number };
  };
}

let db: IDBPDatabase<AnalyticsDB> | null = null;

const initDB = async () => {
  if (db) return db;

  db = await openDB<AnalyticsDB>('analytics-queue', 1, {
    upgrade(db) {
      const store = db.createObjectStore('requests', {
        keyPath: 'id',
        autoIncrement: true,
      });
      store.createIndex('by-created', 'createdAt');
    },
  });

  return db;
};

export const queueAnalyticsRequest = async (request: Omit<AnalyticsRequest, 'retryCount' | 'createdAt'>) => {
  try {
    // Try immediate send
    const response = await fetch(request.url, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        ...(request.token && { Authorization: `Bearer ${request.token}` })
      },
      body: JSON.stringify(request.body),
      keepalive: true
    });

    if (!response.ok) throw new Error('Request failed');

    return response;
  } catch (error) {
    // Queue for retry
    const db = await initDB();
    await db.add('requests', {
      ...request,
      retryCount: 0,
      createdAt: Date.now()
    });

    // Trigger retry processor
    processQueue();
  }
};

const processQueue = async () => {
  const db = await initDB();
  const requests = await db.getAll('requests');

  for (const request of requests) {
    if (request.retryCount >= 3) {
      // Max retries reached, delete
      await db.delete('requests', request.id!);
      continue;
    }

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: {
          'Content-Type': 'application/json',
          ...(request.token && { Authorization: `Bearer ${request.token}` })
        },
        body: JSON.stringify(request.body)
      });

      if (response.ok) {
        // Success, remove from queue
        await db.delete('requests', request.id!);
      } else {
        // Increment retry count
        await db.put('requests', {
          ...request,
          retryCount: request.retryCount + 1
        });
      }
    } catch (error) {
      // Increment retry count
      await db.put('requests', {
        ...request,
        retryCount: request.retryCount + 1
      });
    }
  }
};

// Process queue every 30 seconds
setInterval(processQueue, 30000);

// Process queue on page load
if (typeof window !== 'undefined') {
  window.addEventListener('load', processQueue);
}
```

---

### Phase 3: Data Validation & Quality (MEDIUM PRIORITY)

**Goal:** Add comprehensive validation to prevent invalid data from being stored.

#### [MODIFY] [Analytics.ts](file:///home/kkfergie22/chareli/Server/src/entities/Analytics.ts)

**Add Validation Constraints**

Add column constraints and validation decorators.

**Changes:**
```typescript
import {
  IsEnum,
  IsPositive,
  IsInt,
  Min,
  IsDate,
  ValidateIf
} from 'class-validator';

@Entity('analytics', { schema: 'internal' })
export class Analytics {
  // ... existing columns

  @Column({
    type: 'enum',
    enum: ActivityType,
    nullable: false // Make required
  })
  @IsEnum(ActivityType, { message: 'Invalid activity type' })
  activityType: ActivityType;

  @Column({ type: 'integer', nullable: true })
  @ValidateIf(o => o.duration !== null)
  @IsInt({ message: 'Duration must be an integer' })
  @Min(0, { message: 'Duration cannot be negative' })
  duration?: number;

  @Column({ type: 'integer', nullable: true })
  @ValidateIf(o => o.loadTime !== null)
  @IsInt({ message: 'Load time must be an integer' })
  @Min(0, { message: 'Load time cannot be negative' })
  loadTime?: number;

  @BeforeInsert()
  @BeforeUpdate()
  validateTimestamps() {
    const now = new Date();

    // Validate startTime is not in the future
    if (this.startTime && this.startTime > now) {
      throw new Error('Start time cannot be in the future');
    }

    // Validate endTime is after startTime
    if (this.endTime && this.startTime && this.endTime < this.startTime) {
      throw new Error('End time cannot be before start time');
    }

    // Calculate duration if both times are present
    if (this.startTime && this.endTime) {
      this.duration = Math.floor(
        (this.endTime.getTime() - this.startTime.getTime()) / 1000
      );

      // Ensure non-negative duration
      if (this.duration < 0) {
        this.duration = 0;
      }
    }
  }
}
```

---

#### [MODIFY] [analyticsController.ts](file:///home/kkfergie22/chareli/Server/src/controllers/analyticsController.ts)

**Add Controller-Level Validation**

Validate request data and foreign key existence.

**Changes:**
```typescript
import { validate } from 'class-validator';
import { User } from '../entities/User';
import { Game } from '../entities/Game';

export const createAnalytics = async (req: Request, res: Response) => {
  try {
    const { userId, gameId, activityType, ...rest } = req.body;

    // Validate activity type
    if (!Object.values(ActivityType).includes(activityType)) {
      return res.status(400).json({
        message: 'Invalid activity type'
      });
    }

    // Validate userId exists if provided
    if (userId) {
      const userExists = await User.findOne({ where: { id: userId } });
      if (!userExists) {
        return res.status(400).json({
          message: 'User not found'
        });
      }
    }

    // Validate gameId exists if provided
    if (gameId) {
      const gameExists = await Game.findOne({ where: { id: gameId } });
      if (!gameExists) {
        return res.status(400).json({
          message: 'Game not found'
        });
      }
    }

    // Create analytics entry
    const analytics = Analytics.create({
      userId,
      gameId,
      activityType,
      ...rest
    });

    // Validate entity
    const errors = await validate(analytics);
    if (errors.length > 0) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.map(e => Object.values(e.constraints || {}))
      });
    }

    // Continue with existing queue logic...
  } catch (error) {
    // ... error handling
  }
};
```

---

### Phase 4: Architectural Improvements (LOW PRIORITY)

**Goal:** Improve long-term maintainability and code organization.

#### [MODIFY] [SignupAnalytics.ts](file:///home/kkfergie22/chareli/Server/src/entities/SignupAnalytics.ts)

**Add User Relationship**

Add `userId` field and relationship to enable proper admin filtering.

**Changes:**
```typescript
import { User } from './User';

@Entity('signup_analytics', { schema: 'internal' })
export class SignupAnalytics {
  // ... existing columns

  @Column({ type: 'uuid', nullable: true })
  userId?: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'userId' })
  user?: User;

  // Keep sessionId for anonymous tracking
  @Column({ type: 'varchar', length: 255, nullable: true })
  sessionId?: string;
}
```

**Migration Required:** Yes - adds `userId` column and foreign key

---

#### [MODIFY] [adminDashboardController.ts](file:///home/kkfergie22/chareli/Server/src/controllers/adminDashboardController.ts)

**Update Signup Analytics Queries**

Add admin exclusion to signup analytics queries.

**Changes:**
```typescript
// In getSignupAnalytics and related queries
const signupStats = await SignupAnalytics.createQueryBuilder('signup')
  .leftJoin('signup.user', 'user')
  .leftJoin('user.role', 'role')
  .where('signup.createdAt >= :startDate', { startDate })
  .andWhere('signup.createdAt <= :endDate', { endDate })
  // Exclude admin signups
  .andWhere('(role.name = :playerRole OR signup.userId IS NULL)', {
    playerRole: 'player'
  })
  .getCount();
```

---

#### [NEW] [adminExclusion.service.ts](file:///home/kkfergie22/chareli/Server/src/services/adminExclusion.service.ts)

**Create Centralized Admin Exclusion Service**

New service to centralize admin detection logic.

**Changes:**
```typescript
import { User } from '../entities/User';

const ADMIN_ROLES = ['superadmin', 'admin', 'editor', 'viewer'];

export class AdminExclusionService {
  /**
   * Check if a user is an admin
   */
  static async isAdmin(userId: string): Promise<boolean> {
    const user = await User.findOne({
      where: { id: userId },
      relations: ['role']
    });

    return user?.role ? ADMIN_ROLES.includes(user.role.name) : false;
  }

  /**
   * Check if a user should be excluded from analytics
   */
  static async shouldExclude(userId?: string): Promise<boolean> {
    if (!userId) return false;
    return this.isAdmin(userId);
  }

  /**
   * Get SQL condition for excluding admin users
   */
  static getExclusionCondition(tableAlias: string = 'analytics'): string {
    return `(role.name = 'player' OR ${tableAlias}.userId IS NULL)`;
  }

  /**
   * Get admin role names
   */
  static getAdminRoles(): string[] {
    return [...ADMIN_ROLES];
  }
}
```

---

#### [MODIFY] [authController.ts](file:///home/kkfergie22/chareli/Server/src/controllers/authController.ts)

**Use AdminExclusionService**

Replace direct role checks with centralized service.

**Changes:**
```typescript
import { AdminExclusionService } from '../services/adminExclusion.service';

// In all login/signup analytics tracking
const shouldExclude = await AdminExclusionService.shouldExclude(user.id);

if (!shouldExclude) {
  await Analytics.save({
    userId: user.id,
    activityType: ActivityType.LOGIN,
    // ... rest of analytics data
  });
}
```

---

## Verification Plan

### Automated Tests

```bash
# Test admin exclusion
npm run test:e2e -- --grep "admin exclusion"

# Test analytics data collection
npm run test:e2e -- --grep "analytics tracking"

# Test session ID management
npm run test:e2e -- --grep "session management"
```

### Manual Verification

1. **Admin Exclusion Testing:**
   - Create admin user account
   - Perform login/signup/game play actions
   - Verify no analytics entries created in database
   - Check dashboard metrics don't include admin activity

2. **Data Collection Testing:**
   - Play a game for various durations
   - Trigger different exit scenarios (user exit, error, navigation)
   - Verify exit reasons, load times, and milestones are stored
   - Check Google Analytics for parity

3. **Session ID Testing:**
   - Visit site as anonymous user
   - Check session ID in sessionStorage
   - Login as user
   - Verify session ID is cleared
   - Logout and verify new session ID is created

4. **Data Quality Testing:**
   - Attempt to create analytics with negative duration
   - Attempt to create analytics with future timestamps
   - Attempt to create analytics with invalid activity type
   - Verify all validation errors are caught

5. **Dashboard Metrics:**
   - Compare before/after metrics
   - Verify admin activity is excluded
   - Verify new data points (exit reasons, load times) are displayed
   - Check percentage changes are accurate

### Database Verification Queries

```sql
-- Verify no admin logins tracked
SELECT a.*
FROM internal.analytics a
JOIN public.users u ON a."userId" = u.id
JOIN public.roles r ON u."roleId" = r.id
WHERE a."activityType" = 'login'
AND r.name IN ('superadmin', 'admin', 'editor', 'viewer');
-- Should return 0 rows

-- Verify no admin signups tracked
SELECT sa.*
FROM internal.signup_analytics sa
JOIN public.users u ON sa."userId" = u.id
JOIN public.roles r ON u."roleId" = r.id
WHERE r.name IN ('superadmin', 'admin', 'editor', 'viewer');
-- Should return 0 rows

-- Verify exit reasons are being tracked
SELECT "exitReason", COUNT(*)
FROM internal.analytics
WHERE "exitReason" IS NOT NULL
GROUP BY "exitReason";
-- Should show various exit reasons

-- Verify load times are being tracked
SELECT AVG("loadTime"), MIN("loadTime"), MAX("loadTime")
FROM internal.analytics
WHERE "loadTime" IS NOT NULL;
-- Should show statistics

-- Verify milestones are being tracked
SELECT "milestone", COUNT(*)
FROM internal.analytics
WHERE "milestone" IS NOT NULL
GROUP BY "milestone"
ORDER BY "milestone";
-- Should show [30, 60, 300, 600]
```
