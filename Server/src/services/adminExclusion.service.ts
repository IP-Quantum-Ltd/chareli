import { User } from '../entities/User';
import { AppDataSource } from '../config/database';

// Roles that should inevitably be excluded from analytics tracking
const NON_TRACKED_ROLES = Object.freeze(['superadmin', 'admin', 'editor', 'viewer']);

export class AdminExclusionService {
  /**
   * Check if a user ID belongs to a non-tracked role.
   * Performs a database lookup.
   */
  static async isNonTrackedUser(userId: string): Promise<boolean> {
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { id: userId },
      relations: ['role']
    });

    return user?.role ? NON_TRACKED_ROLES.includes(user.role.name) : false;
  }

  /**
   * Returns true if analytics should be recorded (i.e., user is NOT in a non-tracked role).
   * Optimization: Use this when you only have the ID.
   * Anonymous users (no ID) are always tracked.
   */
  static async shouldTrack(userId?: string): Promise<boolean> {
    if (!userId) return true; // Track anonymous users
    const isNonTracked = await this.isNonTrackedUser(userId);
    return !isNonTracked;
  }

  /**
   * Optimization: Use this when you already have the User object to avoid DB lookup.
   * Default behavior: If role is unknown or missing, we TRACK (fail open for analytics)
   * to avoid data loss on edge cases.
   */
  static shouldTrackUser(user?: User): boolean {
    if (!user) return true;

    // Default to tracking if role name is missing or unknown
    const roleName = user.role?.name;
    if (!roleName) return true;

    return !NON_TRACKED_ROLES.includes(roleName);
  }

  /**
   * Expose the list of non-tracked roles for external use (e.g. SQL queries)
   */
  static getNonTrackedRoles(): readonly string[] {
    return NON_TRACKED_ROLES;
  }
}
