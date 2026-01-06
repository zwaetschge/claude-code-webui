import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { requireAuth } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { config } from '../config';
import type { FileInfo, DirectoryContents } from '@claude-code-webui/shared';

const router = Router();

// Get home directory and common paths
router.get('/home', requireAuth, asyncHandler(async (_req, res) => {
  const homeDir = os.homedir();

  // Check for common directory names (English and German variants)
  const possiblePaths = [
    { name: 'Home', paths: [homeDir] },
    { name: 'Documents', paths: [
      path.join(homeDir, 'Documents'),
      path.join(homeDir, 'Dokumente'),
    ]},
    { name: 'Projects', paths: [
      path.join(homeDir, 'Projects'),
      path.join(homeDir, 'Projekte'),
    ]},
    { name: 'Desktop', paths: [
      path.join(homeDir, 'Desktop'),
      path.join(homeDir, 'Schreibtisch'),
    ]},
    { name: 'Downloads', paths: [
      path.join(homeDir, 'Downloads'),
    ]},
  ];

  const commonPaths: { name: string; path: string }[] = [];

  for (const item of possiblePaths) {
    // Find the first path that exists
    for (const p of item.paths) {
      try {
        await fs.access(p);
        // Path exists, check if it's allowed
        if (config.allowedBasePaths.some(base => p.startsWith(base))) {
          commonPaths.push({ name: item.name, path: p });
          break; // Found one, move to next item
        }
      } catch {
        // Path doesn't exist, try next
      }
    }
  }

  res.json({
    success: true,
    data: {
      homeDir,
      allowedPaths: config.allowedBasePaths,
      commonPaths,
    },
  });
}));

// Validate path is within allowed directories
function validatePath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  const isAllowed = config.allowedBasePaths.some((base) => resolvedPath.startsWith(base));

  if (!isAllowed) {
    throw new AppError('Path not allowed', 403, 'FORBIDDEN_PATH');
  }

  return resolvedPath;
}

// Get file extension
function getExtension(filename: string): string | undefined {
  const ext = path.extname(filename);
  return ext ? ext.slice(1) : undefined;
}

// List directory contents
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const dirPath = req.query.path as string;

  if (!dirPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  const resolvedPath = validatePath(dirPath);

  try {
    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

    const files = await Promise.all(
      entries.map(async (entry): Promise<FileInfo | null> => {
        const fullPath = path.join(resolvedPath, entry.name);
        try {
          const stats = await fs.stat(fullPath);
          return {
            name: entry.name,
            path: fullPath,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: stats.size,
            modifiedAt: stats.mtime.toISOString(),
            extension: entry.isFile() ? getExtension(entry.name) : undefined,
          };
        } catch {
          // Skip files we can't stat (permission denied, etc.)
          return null;
        }
      })
    );

    // Filter out null entries (files we couldn't stat)
    const validFiles = files.filter((f): f is FileInfo => f !== null);

    // Sort: directories first, then by name
    validFiles.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    const result: DirectoryContents = {
      path: resolvedPath,
      files: validFiles,
    };

    res.json({ success: true, data: result });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('Directory not found', 404, 'NOT_FOUND');
    }
    if ((err as NodeJS.ErrnoException).code === 'ENOTDIR') {
      throw new AppError('Path is not a directory', 400, 'NOT_DIRECTORY');
    }
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      throw new AppError('Permission denied', 403, 'PERMISSION_DENIED');
    }
    throw err;
  }
}));

// Get file content
router.get('/content', requireAuth, asyncHandler(async (req, res) => {
  const filePath = req.query.path as string;

  if (!filePath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  const resolvedPath = validatePath(filePath);

  try {
    const stats = await fs.stat(resolvedPath);

    if (stats.isDirectory()) {
      throw new AppError('Path is a directory', 400, 'IS_DIRECTORY');
    }

    // Limit file size (e.g., 1MB)
    if (stats.size > 1024 * 1024) {
      throw new AppError('File too large', 400, 'FILE_TOO_LARGE');
    }

    const content = await fs.readFile(resolvedPath, 'utf-8');

    res.json({
      success: true,
      data: {
        path: resolvedPath,
        content,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('File not found', 404, 'NOT_FOUND');
    }
    throw err;
  }
}));

// Create directory
router.post('/mkdir', requireAuth, asyncHandler(async (req, res) => {
  const { path: dirPath } = req.body;

  if (!dirPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  const resolvedPath = validatePath(dirPath);

  try {
    await fs.mkdir(resolvedPath, { recursive: true });
    res.json({ success: true, data: { path: resolvedPath } });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new AppError('Directory already exists', 409, 'ALREADY_EXISTS');
    }
    throw err;
  }
}));

// Save file content
router.put('/content', requireAuth, asyncHandler(async (req, res) => {
  const { path: filePath, content } = req.body;

  if (!filePath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  if (content === undefined) {
    throw new AppError('Content is required', 400, 'MISSING_CONTENT');
  }

  const resolvedPath = validatePath(filePath);

  try {
    // Check if the path is a file (not a directory)
    try {
      const stats = await fs.stat(resolvedPath);
      if (stats.isDirectory()) {
        throw new AppError('Path is a directory', 400, 'IS_DIRECTORY');
      }
    } catch (err) {
      // File doesn't exist - that's okay, we'll create it
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    await fs.writeFile(resolvedPath, content, 'utf-8');
    const stats = await fs.stat(resolvedPath);

    res.json({
      success: true,
      data: {
        path: resolvedPath,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      throw new AppError('Permission denied', 403, 'PERMISSION_DENIED');
    }
    throw err;
  }
}));

// Delete file or directory
router.delete('/', requireAuth, asyncHandler(async (req, res) => {
  const filePath = req.query.path as string;

  if (!filePath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  const resolvedPath = validatePath(filePath);

  try {
    const stats = await fs.stat(resolvedPath);

    if (stats.isDirectory()) {
      await fs.rm(resolvedPath, { recursive: true });
    } else {
      await fs.unlink(resolvedPath);
    }

    res.json({ success: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('File or directory not found', 404, 'NOT_FOUND');
    }
    throw err;
  }
}));

export default router;
