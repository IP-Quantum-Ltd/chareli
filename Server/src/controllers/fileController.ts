import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { File } from '../entities/Files';
import { ApiError } from '../middlewares/errorHandler';
import { v4 as uuidv4 } from 'uuid';
import { storageService } from '../services/storage.service';
import { zipService } from '../services/zip.service';
import multer from 'multer';
import logger from '../utils/logger';
import { logUploadEvent, toErrorFields } from '../utils/uploadEvents';
import * as path from 'path';

const fileRepository = AppDataSource.getRepository(File);

/**
 * Transform file data to include storage URLs
 */
const transformFileWithStorageUrl = (file: any) => {
  const transformedFile = { ...file };
  
  if (file.s3Key) {
    transformedFile.url = storageService.getPublicUrl(file.s3Key);
  }
  
  return transformedFile;
};

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  }
});

// Middleware to handle file uploads
export const uploadFile = upload.single('file');

// Middleware to handle file uploads for updates
export const uploadFileForUpdate = upload.single('file');

/**
 * @swagger
 * /files:
 *   get:
 *     summary: Get all files
 *     description: Retrieve a list of all files with pagination and filtering options.
 *     tags: [Files]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Number of items per page
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by file type
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for file key
 *     responses:
 *       200:
 *         description: A list of files
 *       500:
 *         description: Internal server error
 */
export const getAllFiles = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { page = 1, limit = 10, type, search } = req.query;
    
    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);
    
    const queryBuilder = fileRepository.createQueryBuilder('file');
    
    if (type) {
      queryBuilder.where('file.type = :type', { type });
    }
    
    if (search) {
      queryBuilder.andWhere(
        'file.s3Key ILIKE :search',
        { search: `%${search}%` }
      );
    }
    
    const total = await queryBuilder.getCount();
    
    queryBuilder
      .skip((pageNumber - 1) * limitNumber)
      .take(limitNumber)
      .orderBy('file.createdAt', 'DESC');
    
    const files = await queryBuilder.getMany();
    
    // Transform files to include storage URLs
    const transformedFiles = files.map(file => transformFileWithStorageUrl(file));
    
    res.status(200).json({
      success: true,
      count: transformedFiles.length,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
      data: transformedFiles,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /files/{id}:
 *   get:
 *     summary: Get file by ID
 *     description: Retrieve a single file by its ID.
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the file to retrieve
 *     responses:
 *       200:
 *         description: File found
 *       404:
 *         description: File not found
 *       500:
 *         description: Internal server error
 */
export const getFileById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    
    const file = await fileRepository.findOne({
      where: { id }
    });
    
    if (!file) {
      return next(ApiError.notFound(`File with id ${id} not found`));
    }
    
    // Transform file to include storage URL
    const transformedFile = transformFileWithStorageUrl(file);
    
    res.status(200).json({
      success: true,
      data: transformedFile,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /files:
 *   post:
 *     summary: Upload a file and create a file record
 *     description: Upload a file to S3 and create a record in the database.
 *     tags: [Files]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - type
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: File to upload
 *               type:
 *                 type: string
 *                 description: Type of file (e.g., 'thumbnail', 'game_file')
 *     responses:
 *       201:
 *         description: File uploaded and record created successfully
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
export const createFile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const started = Date.now();
  try {
    const { type } = req.body;
    const file = req.file;

    logUploadEvent('file.upload.start', {
      userId: req.user?.userId,
      mime: file?.mimetype,
      fileSize: file?.size,
      step: type,
      filename: file?.originalname,
    });

    if (!file) {
      return next(ApiError.badRequest('File is required'));
    }

    if (!type) {
      return next(ApiError.badRequest('File type is required'));
    }
    
    let fileRecord;

    if (type === 'game_file') {
      logger.info('Processing game zip file');
      const processedZip = await zipService.processGameZip(file.buffer);
      
      if (processedZip.error) {
        return next(ApiError.badRequest(processedZip.error));
      }

      const gameId = uuidv4();
      
      const gamePath = `games/${gameId}`;
      await storageService.uploadDirectory(processedZip.extractedPath, gamePath);

      if (!processedZip.indexPath) {
        return next(ApiError.badRequest('No index.html found in the zip file'));
      }

      const indexPath = processedZip.indexPath.replace(/\\/g, '/');
      fileRecord = fileRepository.create({
        s3Key: `${gamePath}/${indexPath}`,
        type: 'game_file'
      });

      await fileRepository.save(fileRecord);
    } else {
      logger.info(`Uploading file to storage: ${file.originalname}`);
      const uploadResult = await storageService.uploadFile(
        file.buffer,
        file.originalname,
        file.mimetype,
        type
      );
      
      logger.info('Creating file record in database');
      fileRecord = fileRepository.create({
        s3Key: uploadResult.key,
        type
      });
      
      await fileRepository.save(fileRecord);
    }
    
    // Transform file to include storage URL
    const transformedFile = transformFileWithStorageUrl(fileRecord);

    logUploadEvent('file.upload.persisted', {
      userId: req.user?.userId,
      fileId: fileRecord.id,
      fileKey: fileRecord.s3Key,
      step: fileRecord.type,
      durationMs: Date.now() - started,
    });

    res.status(201).json({
      success: true,
      data: transformedFile,
    });
  } catch (error) {
    logUploadEvent(
      'file.upload.failed',
      {
        userId: req.user?.userId,
        durationMs: Date.now() - started,
        ...toErrorFields(error),
      },
      'error'
    );
    next(error);
  }
};

/**
 * @swagger
 * /files/{id}:
 *   put:
 *     summary: Update a file record
 *     description: Update a file record by its ID, optionally replacing the file.
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the file to update
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: New file to upload (optional)
 *               type:
 *                 type: string
 *                 description: Type of file (e.g., 'thumbnail', 'game_file')
 *     responses:
 *       200:
 *         description: File record updated successfully
 *       400:
 *         description: Bad request
 *       404:
 *         description: File not found
 *       500:
 *         description: Internal server error
 */
export const updateFile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { type } = req.body;
    const uploadedFile = req.file;
    
    const file = await fileRepository.findOne({
      where: { id }
    });
    
    if (!file) {
      return next(ApiError.notFound(`File with id ${id} not found`));
    }
    
    if (uploadedFile) {
      logger.info(`Uploading new file to storage: ${uploadedFile.originalname}`);
      const uploadResult = await storageService.uploadFile(
        uploadedFile.buffer,
        uploadedFile.originalname,
        uploadedFile.mimetype,
        file.type
      );
      
      file.s3Key = uploadResult.key;
    }
    
    if (type) {
      file.type = type;
    }
    
    await fileRepository.save(file);
    
    // Transform file to include storage URL
    const transformedFile = transformFileWithStorageUrl(file);
    
    res.status(200).json({
      success: true,
      data: transformedFile,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /files/{id}:
 *   delete:
 *     summary: Delete a file record
 *     description: Delete a file record by its ID.
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the file to delete
 *     responses:
 *       200:
 *         description: File record deleted successfully
 *       404:
 *         description: File not found
 *       500:
 *         description: Internal server error
 */
export const deleteFile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    
    const file = await fileRepository.findOne({
      where: { id }
    });
    
    if (!file) {
      return next(ApiError.notFound(`File with id ${id} not found`));
    }
    
    try {
      logger.info(`Deleting file from storage: ${file.s3Key}`);
      await storageService.deleteFile(file.s3Key);
    } catch (error) {
      logger.warn(`Failed to delete file from storage: ${error}`);
    }
    
    await fileRepository.remove(file);
    
    res.status(200).json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};
