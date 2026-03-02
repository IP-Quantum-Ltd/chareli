import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { ApiError } from '../middlewares/errorHandler';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User';
import { Analytics } from '../entities/Analytics';
import { OtpType } from '../entities/Otp';
import { SystemConfig } from '../entities/SystemConfig';
import { otpService } from '../services/otp.service';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { getCountryFromIP, extractClientIP } from '../utils/ipUtils';
import { detectDeviceType } from '../utils/deviceUtils';
import logger from '../utils/logger';
import { AdminExclusionService } from '../services/adminExclusion.service';

// Section: Core Authentication
// This controller handles core authentication functions like registration, login, and OTP verification

const userRepository = AppDataSource.getRepository(User);
const analyticsRepository = AppDataSource.getRepository(Analytics);
const systemConfigRepository = AppDataSource.getRepository(SystemConfig);

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new player account
 *     description: Register a new player account. Only player role is allowed for direct registration.
 *     tags: [Authentication]
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
 *               - phoneNumber
 *               - hasAcceptedTerms
 *           example:
 *             firstName: "John"
 *             lastName: "Doe"
 *             email: "john.doe@example.com"
 *             password: "StrongPassword123!"
 *             phoneNumber: "+1234567890"
 *             isAdult: true
 *             hasAcceptedTerms: true
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
export const registerPlayer = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { firstName, lastName, email, password, phoneNumber, isAdult = true, hasAcceptedTerms = true } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !password || !phoneNumber) {
      return next(ApiError.badRequest('All fields are required'));
    }

    // Get IP address
    const forwarded = req.headers['x-forwarded-for'];
    const ipAddress = extractClientIP(forwarded, req.socket.remoteAddress || req.ip || '');

    // Get country from IP
    const country = await getCountryFromIP(ipAddress);

    // Get device type from user agent
    const userAgent = req.headers['user-agent'] || '';
    const deviceType = detectDeviceType(userAgent);

    // Register the user
    const user = await authService.registerPlayer(
      firstName,
      lastName,
      email,
      password,
      phoneNumber,
      isAdult || false,
      hasAcceptedTerms,
      country || undefined,
      ipAddress,
      deviceType
    );

    // Create analytics entry for signup - only for players
    const userWithRole = await userRepository.findOne({
      where: { id: user.id },
      relations: ['role']
    });

    if (AdminExclusionService.shouldTrackUser(userWithRole || undefined)) {
      const signupAnalytics = new Analytics();
      signupAnalytics.userId = user.id;
      signupAnalytics.activityType = 'Signed up';
      await analyticsRepository.save(signupAnalytics);
    }

    res.status(201).json({
      success: true,
      message: 'User registered successfully.',
      data: {
        userId: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber
      }
    });
  } catch (error) {
    next(error instanceof Error ? ApiError.badRequest(error.message) : error);
  }
};

/**
 * @swagger
 * /auth/register/{token}:
 *   post:
 *     summary: Register from invitation
 *     description: Register a new account from an invitation token
 *     tags: [Authentication]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Invitation token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - password
 *               - phoneNumber
 *               - hasAcceptedTerms
 *           example:
 *             firstName: "Jane"
 *             lastName: "Smith"
 *             password: "SecurePassword456!"
 *             phoneNumber: "+1987654321"
 *             isAdult: true
 *             hasAcceptedTerms: true
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Bad request
 *       404:
 *         description: Invitation not found
 *       500:
 *         description: Internal server error
 */
export const registerFromInvitation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token } = req.params;
    const { firstName, lastName, password, phoneNumber, isAdult = true, hasAcceptedTerms = true } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !password || !phoneNumber) {
      return next(ApiError.badRequest('All fields are required'));
    }

    // Get IP address
    const forwarded = req.headers['x-forwarded-for'];
    const ipAddress = extractClientIP(forwarded, req.socket.remoteAddress || req.ip || '');

    // Get country from IP
    const country = await getCountryFromIP(ipAddress);

    // Get device type from user agent
    const userAgent = req.headers['user-agent'] || '';
    const deviceType = detectDeviceType(userAgent);

    // Register the user
    const user = await authService.registerFromInvitation(
      token,
      firstName,
      lastName,
      password,
      phoneNumber,
      isAdult || false,
      hasAcceptedTerms,
      country || undefined,
      ipAddress,
      deviceType
    );

    // Create analytics entry for signup from invitation - only for players
    const userWithRole = await userRepository.findOne({
      where: { id: user.id },
      relations: ['role']
    });

    if (AdminExclusionService.shouldTrackUser(userWithRole || undefined)) {
      const signupAnalytics = new Analytics();
      signupAnalytics.userId = user.id;
      signupAnalytics.activityType = 'Signed up from invitation';
      // Don't set startTime for non-game activities
      // Don't set sessionCount for non-game activities
      await analyticsRepository.save(signupAnalytics);
    }

    res.status(201).json({
      success: true,
      message: 'User registered successfully from invitation.',
      data: {
        userId: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber
      }
    });
  } catch (error) {
    next(error instanceof Error ? ApiError.badRequest(error.message) : error);
  }
};

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login
 *     description: Login with email or phone number and password
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *               - password
 *           example:
 *             identifier: "john.doe@example.com or +1234567890"
 *             password: "StrongPassword123!"
 *     responses:
 *       200:
 *         description: Login successful, OTP sent
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return next(ApiError.badRequest('Identifier (email or phone) and password are required'));
    }

    const user = await authService.login(identifier, password);

    // Update device type on login
    const userAgent = req.headers['user-agent'] || '';
    const deviceType = detectDeviceType(userAgent);
    if (deviceType && deviceType !== user.lastKnownDeviceType) {
      user.lastKnownDeviceType = deviceType;
      await userRepository.save(user);
    }

    if (user.hasCompletedFirstLogin) {
      const tokens = await authService.generateTokens(user);
      user.lastLoggedIn = new Date();
      await userRepository.save(user);

      // Only track login analytics for players, not admins
      const userWithRole = await userRepository.findOne({
        where: { id: user.id },
        relations: ['role']
      });

      if (AdminExclusionService.shouldTrackUser(userWithRole || undefined)) {
        const loginAnalytics = new Analytics();
        loginAnalytics.userId = user.id;
        loginAnalytics.activityType = 'Logged in';
        await analyticsRepository.save(loginAnalytics);
      }

      res.status(200).json({
        success: true,
        message: 'Login successful.',
        data: {
          userId: user.id,
          requiresOtp: false,
          tokens,
          email: user.email,
          phoneNumber: user.phoneNumber,
          role: user?.role.name
        }
      });
      return;
    }

    // For first-time login, check if OTP is required based on admin configuration
    try {
      const otpType = await authService.determineOtpDeliveryMethod(user);

      if (otpType === OtpType.NONE) {
        const tokens = await authService.generateTokens(user);
        user.lastLoggedIn = new Date();
        user.hasCompletedFirstLogin = true;
        await userRepository.save(user);

        // Create analytics entry for login - only for players
        const userWithRole = await userRepository.findOne({
          where: { id: user.id },
          relations: ['role']
        });

        if (AdminExclusionService.shouldTrackUser(userWithRole || undefined)) {
          const loginAnalytics = new Analytics();
          loginAnalytics.userId = user.id;
          loginAnalytics.activityType = 'Logged in';
          await analyticsRepository.save(loginAnalytics);
        }

        res.status(200).json({
          success: true,
          message: 'Login successful.',
          data: {
            userId: user.id,
            requiresOtp: false,
            tokens,
            email: user.email,
            phoneNumber: user.phoneNumber,
            role: user?.role.name
          }
        });
        return;
      }

      // OTP is required - send OTP
      const otpResult = await authService.sendOtp(user, otpType);
      res.status(200).json({
        success: true,
        message: `First-time login. ${otpResult.message}`,
        data: {
          userId: user.id,
          requiresOtp: true,
          otpType: otpResult.actualType,
          email: user.email,
          phoneNumber: user.phoneNumber
        }
      });
    } catch (error) {
      if (error instanceof Error) {
        // Check if it's a configuration error (user missing required contact info)
        if (error.message.includes('We couldn’t send a verification')) {

          logger.error('OTP Configuration Error:', error.message);

          res.status(200).json({
            success: false,
            message: "Your account needs additional verification information. Please contact support for assistance.",
            data: {
              userId: user.id,
              email: user.email,
              phoneNumber: user.phoneNumber
            },
            debug: {
              error: error.message,
              type: 'CONFIGURATION',
              timestamp: new Date().toISOString()
            }
          });
          return;
        }

        // Check if it's a service error (Twilio, email service, etc.)
        if (error.message.includes('Twilio') ||
            error.message.includes('SMTP') ||
            error.message.includes('email service') ||
            error.message.includes('SMS service')) {

          logger.error('OTP Service Error:', error.message);

          res.status(200).json({
            success: false,
            message: "We're experiencing technical difficulties with our verification system. Please try again in a few minutes.",
            data: {
              userId: user.id,
              email: user.email,
              phoneNumber: user.phoneNumber
            },
            debug: {
              error: error.message,
              type: 'SERVICE',
              timestamp: new Date().toISOString()
            }
          });
          return;
        }

        // Generic OTP error
        logger.error('OTP Error:', error.message);

        res.status(200).json({
          success: false,
          message: "Verification system temporarily unavailable. Please contact support if this continues.",
          data: {
            userId: user.id,
            email: user.email,
            phoneNumber: user.phoneNumber
          },
          debug: {
            error: error.message,
            type: 'UNKNOWN',
            timestamp: new Date().toISOString()
          }
        });
        return;
      }
      throw error;
    }
  } catch (error) {
    next(error instanceof Error ? ApiError.unauthorized(error.message) : error);
  }
};

/**
 * @swagger
 * /auth/verify-otp:
 *   post:
 *     summary: Verify OTP
 *     description: Verify OTP and get JWT tokens
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - otp
 *           example:
 *             userId: "cff600fe-639b-4c1f-880b-58d23af4a2c7"
 *             otp: "123456"
 *     responses:
 *       200:
 *         description: OTP verified, tokens generated
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
export const verifyOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return next(ApiError.badRequest('User ID and OTP are required'));
    }

    // Verify OTP and generate tokens
    const tokens = await authService.verifyOtp(userId, otp);

    // Update user after successful OTP verification
    const user = await userRepository.findOne({ where: { id: userId, isDeleted: false } });
    if (user) {
      user.lastLoggedIn = new Date();
      // Mark user as having completed first login
      user.hasCompletedFirstLogin = true;
      await userRepository.save(user);

      // Create analytics entry for login - only for players
      const userWithRole = await userRepository.findOne({
        where: { id: user.id },
        relations: ['role']
      });

      if (AdminExclusionService.shouldTrackUser(userWithRole || undefined)) {
        const loginAnalytics = new Analytics();
        loginAnalytics.userId = user.id;
        loginAnalytics.activityType = 'Logged in';
        await analyticsRepository.save(loginAnalytics);
      }
    }

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      data: tokens
    });
  } catch (error) {
    next(error instanceof Error ? ApiError.badRequest(error.message) : error);
  }
};

/**
 * @swagger
 * /auth/refresh-token:
 *   post:
 *     summary: Refresh token
 *     description: Get new access token using refresh token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *           example:
 *             refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjZmY2MDBmZS02MzliLTRjMWYtODgwYi01OGQyM2FmNGEyYzciLCJlbWFpbCI6ImpvaG4uZG9lQGV4YW1wbGUuY29tIiwicm9sZSI6InBsYXllciIsImlhdCI6MTcxNzE1MTY2M30.example-refresh-token"
 *     responses:
 *       200:
 *         description: New tokens generated
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
export const refreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    // Validate required fields
    if (!refreshToken) {
      return next(ApiError.badRequest('Refresh token is required'));
    }

    // Refresh token
    const tokens = await authService.refreshToken(refreshToken);

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: tokens
    });
  } catch (error) {
    next(error instanceof Error ? ApiError.unauthorized(error.message) : error);
  }
};

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Forgot password (Email)
 *     description: Request a password reset link to be sent to your email
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *           example:
 *             email: "john.doe@example.com"
 *     responses:
 *       200:
 *         description: Password reset link sent if email exists
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      return next(ApiError.badRequest('Email is required'));
    }

    // Request password reset
    await authService.requestPasswordReset(email);

    // Always return success to prevent email enumeration
    res.status(200).json({
      success: true,
      message: 'If your email exists in our system, you will receive a password reset link shortly.'
    });
  } catch (error) {
    // Log the error but don't expose it to the client
    next(ApiError.internal('An error occurred while processing your request'));
  }
};

/**
 * @swagger
 * /auth/reset-password/{token}:
 *   get:
 *     summary: Verify reset token
 *     description: Verify if a password reset token is valid
 *     tags: [Authentication]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Password reset token
 *     responses:
 *       200:
 *         description: Token is valid
 *       400:
 *         description: Invalid or expired token
 *       500:
 *         description: Internal server error
 */
export const verifyResetToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token } = req.params;

    // Verify reset token
    await authService.verifyResetToken(token);

    res.status(200).json({
      success: true,
      message: 'Token is valid'
    });
  } catch (error) {
    next(ApiError.badRequest('Invalid or expired reset token'));
  }
};

/**
 * @swagger
 * /auth/reset-password/{token}:
 *   post:
 *     summary: Reset password
 *     description: Reset password using a valid reset token
 *     tags: [Authentication]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Password reset token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *               - confirmPassword
 *           example:
 *             password: "NewStrongPassword123!"
 *             confirmPassword: "NewStrongPassword123!"
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
/**
 * @swagger
 * /auth/forgot-password/phone:
 *   post:
 *     summary: Forgot password (Phone)
 *     description: Request a password reset OTP to be sent to your phone
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *           example:
 *             phoneNumber: "+1234567890"
 *     responses:
 *       200:
 *         description: OTP sent if phone number exists
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
export const forgotPasswordPhone = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return next(ApiError.badRequest('Phone number is required'));
    }

    // Find user by phone number
    const user = await userRepository.findOne({ where: { phoneNumber, isDeleted: false } });

    // Always return success to prevent phone number enumeration
    if (!user) {
      res.status(200).json({
        success: true,
        message: 'If your phone number exists in our system, you will receive a reset code shortly.'
      });
      return;
    }

    // Generate and send OTP
    const otp = await otpService.generateOtp(user.id, OtpType.SMS);
    await otpService.sendOtp(user.id, otp, OtpType.SMS);

    res.status(200).json({
      success: true,
      message: 'Reset code sent to your phone number.',
      data: {
        userId: user.id
      }
    });
  } catch (error) {
    next(ApiError.internal('An error occurred while processing your request'));
  }
};

/**
 * @swagger
 * /auth/reset-password/phone:
 *   post:
 *     summary: Reset password (Phone)
 *     description: Reset password after OTP verification via phone
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - password
 *               - confirmPassword
 *           example:
 *             userId: "cff600fe-639b-4c1f-880b-58d23af4a2c7"
 *             password: "NewStrongPassword123!"
 *             confirmPassword: "NewStrongPassword123!"
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token } = req.params;
    const { userId, password, confirmPassword } = req.body;

    // Validate required fields
    if (!password || !confirmPassword) {
      return next(ApiError.badRequest('All fields are required'));
    }

    // Validate password match
    if (password !== confirmPassword) {
      return next(ApiError.badRequest('Passwords do not match'));
    }

    let user;
    if (token) {
      // Email flow - verify token and get user
      user = await authService.verifyResetToken(token);
    } else if (userId) {
      // Phone flow - get user directly (OTP already verified)
      user = await userRepository.findOne({ where: { id: userId, isDeleted: false } });
      if (!user) {
        return next(ApiError.notFound('User not found'));
      }
    } else {
      return next(ApiError.badRequest('Token or userId is required'));
    }

    // Hash and update password
    user.password = await bcrypt.hash(password, 10);
    if (token) {
      // Clear reset token if email flow
      user.resetToken = '';
      user.resetTokenExpiry = new Date(0);
    }
    await userRepository.save(user);

    res.status(200).json({
      success: true,
      message: 'Password reset successful. You can now log in with your new password.'
    });
  } catch (error) {
    next(error instanceof Error ? ApiError.badRequest(error.message) : error);
  }
};

/**
 * @swagger
 * /auth/request-otp:
 *   post:
 *     summary: Request OTP
 *     description: Request an OTP to be sent to email, phone, or both
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - otpType
 *           example:
 *             userId: "cff600fe-639b-4c1f-880b-58d23af4a2c7"
 *             otpType: "SMS"
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
export const requestOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId, otpType } = req.body;

    // Validate required fields
    if (!userId || !otpType) {
      return next(ApiError.badRequest('User ID and OTP type are required'));
    }

    // Find the user
    const user = await userRepository.findOne({ where: { id: userId, isDeleted: false } });
    if (!user) {
      return next(ApiError.notFound('User not found'));
    }

    // Send OTP with fallback handling
    const otpResult = await authService.sendOtp(user, otpType);

    res.status(200).json({
      success: true,
      message: otpResult.message,
      data: {
        userId: user.id,
        actualType: otpResult.actualType
      }
    });
  } catch (error) {
    next(error instanceof Error ? ApiError.badRequest(error.message) : error);
  }
};
