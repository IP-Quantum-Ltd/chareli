import { Request, Response, NextFunction } from "express";
import { AppDataSource } from "../config/database";
import { User } from "../entities/User";
import { Role, RoleType } from "../entities/Role";
import { Analytics } from "../entities/Analytics";
import { ApiError } from "../middlewares/errorHandler";
import * as bcrypt from "bcrypt";
import { authService } from "../services/auth.service";
import { OtpType } from "../entities/Otp";
import { Not, IsNull } from "typeorm";
import { storageService } from "../services/storage.service";
import { getCountryFromIP, extractClientIP } from "../utils/ipUtils";
import { detectDeviceType } from "../utils/deviceUtils";
import { emailService } from "../services/email.service";
import { anonymizationService } from "../services/anonymization.service";
import logger from "../utils/logger";

const userRepository = AppDataSource.getRepository(User);
const roleRepository = AppDataSource.getRepository(Role);
const analyticsRepository = AppDataSource.getRepository(Analytics);

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Get all users
 *     description: Retrieve a list of all users. Accessible by admins.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: A list of users
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal server error
 */
export const getAllUsers = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const users = await userRepository.find({
      where: { isDeleted: false },
      relations: ["role"],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
        role: {
          id: true,
          name: true,
          description: true,
        },
      },
    });

    res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /users/me/stats:
 *   get:
 *     summary: Get current user's game statistics
 *     description: Retrieve game play statistics for the currently logged in user.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User stats retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
export const getCurrentUserStats = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // If user is not authenticated, send default stats
    if (!req.user || !req.user.userId) {
      res.status(200).json({
        success: true,
        data: {
          totalSeconds: 0,
          totalPlays: 0,
          gamesPlayed: [],
        },
      });
      return;
    }

    const userId = req.user.userId;

    // Get total minutes played
    const totalTimeResult = await analyticsRepository
      .createQueryBuilder("analytics")
      .select("SUM(analytics.duration)", "totalDuration")
      .where("analytics.userId = :userId", { userId })
      .andWhere("analytics.startTime IS NOT NULL")
      .andWhere("analytics.endTime IS NOT NULL")
      .getRawOne();

    // Get total play count (only count entries with gameId)
    const totalPlaysResult = await analyticsRepository.count({
      where: {
        userId,
        gameId: Not(IsNull()),
        startTime: Not(IsNull()),
        endTime: Not(IsNull()),
      },
    });

    // Get games played with details
    const gamesPlayed = await analyticsRepository
      .createQueryBuilder("analytics")
      .select("analytics.gameId", "gameId")
      .addSelect("game.title", "title")
      .addSelect("thumbnailFile.s3Key", "thumbnailKey")
      .addSelect("SUM(analytics.duration)", "totalDuration")
      .addSelect("MAX(analytics.startTime)", "lastPlayed")
      .leftJoin("analytics.game", "game")
      .leftJoin("game.thumbnailFile", "thumbnailFile")
      .where(
        "analytics.userId = :userId AND analytics.gameId IS NOT NULL AND analytics.duration >= :duration",
        {
          userId,
          duration: 30,
        }
      )
      .andWhere("analytics.startTime IS NOT NULL")
      .andWhere("analytics.endTime IS NOT NULL")
      .groupBy("analytics.gameId")
      .addGroupBy("game.title")
      .addGroupBy("thumbnailFile.s3Key")
      .orderBy("SUM(analytics.duration)", "DESC")
      .limit(3)
      .getRawMany();

    // Format the response
    const formattedGames = await Promise.all(
      gamesPlayed.map(async (game) => ({
        gameId: game.gameId,
        title: game.title,
        thumbnailUrl: game.thumbnailKey
          ? storageService.getPublicUrl(game.thumbnailKey)
          : null,
        totalSeconds: game.totalDuration || 0,
        lastPlayed: game.lastPlayed,
      }))
    );

    // Send total duration in seconds
    const totalSeconds = totalTimeResult?.totalDuration || 0;

    res.status(200).json({
      success: true,
      data: {
        totalSeconds,
        totalPlays: totalPlaysResult,
        gamesPlayed: formattedGames,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get user by ID
 *     description: Retrieve a single user by their ID. Users can view their own profile, admins can view any profile.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the user to retrieve
 *     responses:
 *       200:
 *         description: User found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
export const getUserById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await userRepository.findOne({
      where: { id, isDeleted: false },
      relations: ["role"],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
        role: {
          id: true,
          name: true,
          description: true,
        },
      },
    });

    if (!user) {
      return next(ApiError.notFound(`User with id ${id} not found`));
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /users:
 *   post:
 *     summary: Create a new user
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - email
 *               - password
 *           example:
 *             firstName: "Alex"
 *             lastName: "Johnson"
 *             email: "alex.johnson@example.com"
 *             password: "SecurePass789!"
 *             phoneNumber: "+1555123456"
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal server error
 */
export const createUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phoneNumber,
      isAdult,
      hasAcceptedTerms,
    } = req.body;

    // Get IP address with error handling
    let ipAddress = '';
    let country = null;
    let deviceType = 'unknown';

    try {
      const forwarded = req.headers["x-forwarded-for"];
      ipAddress = extractClientIP(
        forwarded,
        req.socket.remoteAddress || req.ip || ""
      );

      logger.info('[IP_TRACKING] IP extracted', { email, ipAddress, isEmpty: ipAddress === '' });

      // Get country from IP
      country = await getCountryFromIP(ipAddress);

      // Get device type from user agent
      const userAgent = req.headers['user-agent'] || '';
      deviceType = detectDeviceType(userAgent);
    } catch (error) {
      logger.error('[IP_TRACKING] IP extraction failed', { email, error: error instanceof Error ? error.message : String(error) });
      // Continue with user creation even if IP extraction fails
    }

    // Check if user with email already exists (including deleted users)
    if (email || phoneNumber) {
      const existingUser = await userRepository.findOne({
        where: [{ email }, { phoneNumber }],
        select: ["id", "email", "phoneNumber", "isDeleted"],
      });

      if (existingUser) {
        if (existingUser.email === email) {
          return next(
            ApiError.badRequest("An account with this email already exists")
          );
        }
        if (existingUser.phoneNumber === phoneNumber) {
          return next(
            ApiError.badRequest(
              "An account with this phone number already exists"
            )
          );
        }
      }
    }

    // Get the role
    const role = await roleRepository.findOne({
      where: { name: RoleType.PLAYER },
    });

    if (!role) {
      return next(ApiError.badRequest("Invalid role"));
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create new user
    const user = userRepository.create({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      phoneNumber,
      role,
      roleId: role.id,
      isVerified: false,
      isActive: true,
      isAdult: isAdult || false,
      hasAcceptedTerms,
      country: country || undefined,
      registrationIpAddress: ipAddress,
      lastKnownDeviceType: deviceType,
    });

    await userRepository.save(user);

    // Create analytics entry for signup
    // Create analytics entry for signup - only for players
    const userWithRole = await userRepository.findOne({
      where: { id: user.id },
      relations: ['role']
    });

    if (userWithRole?.role?.name === 'player') {
      const signupAnalytics = new Analytics();
      signupAnalytics.userId = user.id;
      signupAnalytics.activityType = "Signed up";
      await analyticsRepository.save(signupAnalytics);
    }

    // Don't return sensitive information
    const { password: _, ...userWithoutSensitiveInfo } = user;

    res.status(201).json({
      success: true,
      message: "User created successfully. Please login to continue.",
      data: userWithoutSensitiveInfo,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /users/{id}:
 *   put:
 *     summary: Update a user
 *     description: Update a user's information by their ID. Users can update their own profile, admins can update any profile.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the user to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *           example:
 *             firstName: "Alexander"
 *             lastName: "Johnson"
 *             phoneNumber: "+1555123789"
 *             isActive: true
 *     responses:
 *       200:
 *         description: User updated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
export const updateUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      firstName,
      lastName,
      email,
      phoneNumber,
      roleId,
      isActive,
      password,
    } = req.body;

    const user = await userRepository.findOne({
      where: { id, isDeleted: false },
      relations: ["role"],
    });

    if (!user) {
      return next(ApiError.notFound(`User with id ${id} not found`));
    }

    // If trying to update role, check permissions
    if (roleId && roleId !== user.roleId) {
      // Only admins can change roles
      if (
        req.user?.role !== RoleType.ADMIN &&
        req.user?.role !== RoleType.SUPERADMIN
      ) {
        return next(ApiError.forbidden("Only admins can change user roles"));
      }

      // Get the new role
      const newRole = await roleRepository.findOne({
        where: { id: roleId },
      });

      if (!newRole) {
        return next(ApiError.badRequest("Invalid role"));
      }

      // Admin can only assign editor and player roles
      if (
        req.user.role === RoleType.ADMIN &&
        (newRole.name === RoleType.SUPERADMIN ||
          newRole.name === RoleType.ADMIN)
      ) {
        return next(
          ApiError.forbidden("Admin can only assign editor and player roles")
        );
      }

      user.role = newRole;
      user.roleId = roleId;
    }

    // If trying to update active status, check permissions
    if (isActive !== undefined && isActive !== user.isActive) {
      // Only admins can activate/deactivate users
      if (
        req.user?.role !== RoleType.ADMIN &&
        req.user?.role !== RoleType.SUPERADMIN
      ) {
        return next(
          ApiError.forbidden("Only admins can activate/deactivate users")
        );
      }

      // Admin cannot deactivate superadmin
      if (
        req.user.role === RoleType.ADMIN &&
        user.role.name === RoleType.SUPERADMIN &&
        !isActive
      ) {
        return next(ApiError.forbidden("Admin cannot deactivate superadmin"));
      }

      user.isActive = isActive;
    }

    // Update basic user properties
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (email && email !== user.email) {
      // Check if email is already in use
      const existingUser = await userRepository.findOne({
        where: { email, isDeleted: false },
      });

      if (existingUser && existingUser.id !== id) {
        return next(ApiError.badRequest("Email is already in use"));
      }

      user.email = email;
    }
    if (phoneNumber) user.phoneNumber = phoneNumber;

    // Update password if provided
    if (password) {
      const saltRounds = 10;
      user.password = await bcrypt.hash(password, saltRounds);
    }

    await userRepository.save(user);

    // Don't return sensitive information
    const { password: _, ...userWithoutSensitiveInfo } = user;

    res.status(200).json({
      success: true,
      data: userWithoutSensitiveInfo,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     summary: Delete a user
 *     description: Delete a user by their ID with email notification. Can be used by admins to delete other users or by users to deactivate their own account.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the user to delete
 *     responses:
 *       200:
 *         description: User deleted/deactivated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
export const deleteUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const currentUserId = req.user?.userId;
    const currentUserRole = req.user?.role;

    const user = await userRepository.findOne({
      where: { id, isDeleted: false },
      relations: ["role"],
    });

    if (!user) {
      return next(ApiError.notFound(`User with id ${id} not found`));
    }

    // Determine if this is self-deactivation or admin deletion
    const isSelfDeactivation = currentUserId === id;

    // If not self-deactivation, check admin permissions
    if (!isSelfDeactivation) {
      // Only admins can delete other users
      if (
        currentUserRole !== RoleType.ADMIN &&
        currentUserRole !== RoleType.SUPERADMIN
      ) {
        return next(ApiError.forbidden("Only admins can delete other users"));
      }

      // Admin cannot delete superadmin
      if (
        currentUserRole === RoleType.ADMIN &&
        user.role.name === RoleType.SUPERADMIN
      ) {
        return next(ApiError.forbidden("Admin cannot delete superadmin"));
      }
    }

    // Store user data for email notification
    const userEmail = user.email;
    const userName =
      `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User";

    // Send appropriate email based on who is performing the action
    try {
      if (userEmail) {
        await emailService.sendAccountDeletionEmail(
          userEmail,
          userName,
          isSelfDeactivation
        );
      }
    } catch (emailError) {
      // Log email error but don't fail the deletion process
      console.error(
        `Failed to send account ${
          isSelfDeactivation ? "deactivation" : "deletion"
        } email:`,
        emailError
      );
    }

    // Anonymize user data (GDPR compliant soft deletion)
    await anonymizationService.anonymizeUserData(id);

    const actionMessage = isSelfDeactivation
      ? "Account deactivated and data anonymized successfully. Notification email sent."
      : "User deleted and data anonymized successfully. Notification email sent.";

    res.status(200).json({
      success: true,
      message: actionMessage,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /users/heartbeat:
 *   post:
 *     summary: Send heartbeat to maintain online status
 *     description: Updates user's lastSeen timestamp to maintain online presence. Frontend should call this every 30-60 seconds.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Heartbeat received successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
export const sendHeartbeat = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user?.userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const now = new Date();

    // Update user's lastSeen timestamp
    await userRepository.update(req.user.userId, {
      lastSeen: now,
    });

    res.status(200).json({
      success: true,
      message: "Heartbeat received",
      timestamp: now.toISOString(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /users/online-status:
 *   get:
 *     summary: Get current online status
 *     description: Returns whether the current user is considered online based on their last activity
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Online status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     isOnline:
 *                       type: boolean
 *                     lastSeen:
 *                       type: string
 *                       format: date-time
 *                     onlineThreshold:
 *                       type: number
 *                       description: Minutes threshold for online status
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
export const getOnlineStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user?.userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const user = await userRepository.findOne({
      where: { id: req.user.userId, isDeleted: false },
      select: ["id", "lastSeen", "isActive"],
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const isOnline =
      user.lastSeen && user.lastSeen > fiveMinutesAgo && user.isActive;

    res.status(200).json({
      success: true,
      data: {
        isOnline: !!isOnline,
        lastSeen: user.lastSeen,
        onlineThreshold: 5, // minutes
      },
    });
  } catch (error) {
    next(error);
  }
};
