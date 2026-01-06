import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { githubService } from '../services/github';

const router = Router();

// Validation schemas
const createRepoSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  description: z.string().max(500).optional(),
  private: z.boolean().optional(),
  auto_init: z.boolean().optional(),
});

const cloneRepoSchema = z.object({
  url: z.string().url(),
  targetDir: z.string().min(1),
  branch: z.string().optional(),
});

const pushSchema = z.object({
  workingDirectory: z.string().min(1),
  remote: z.string().optional(),
  branch: z.string().optional(),
  force: z.boolean().optional(),
});

const addRemoteSchema = z.object({
  workingDirectory: z.string().min(1),
  remoteName: z.string().min(1),
  repoUrl: z.string().url(),
});

// Validate token
router.get('/token/validate', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const result = await githubService.validateToken(userId);
  res.json({ success: true, data: result });
});

// Get authenticated user
router.get('/user', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const user = await githubService.getUser(userId);

  if (!user) {
    throw new AppError('Failed to get GitHub user', 401, 'GITHUB_AUTH_ERROR');
  }

  res.json({ success: true, data: user });
});

// List repositories
router.get('/repos', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const page = parseInt(req.query.page as string) || 1;
  const perPage = Math.min(parseInt(req.query.per_page as string) || 30, 100);

  const result = await githubService.listRepos(userId, page, perPage);
  res.json({ success: true, data: result });
});

// Create repository
router.post('/repos', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = createRepoSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const result = await githubService.createRepo(userId, parsed.data);

  if (!result.success) {
    throw new AppError(result.error || 'Failed to create repository', 400, 'CREATE_REPO_ERROR');
  }

  res.status(201).json({ success: true, data: result.repo });
});

// Clone repository
router.post('/clone', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = cloneRepoSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { url, targetDir, branch } = parsed.data;
  const result = await githubService.cloneRepo(userId, url, targetDir, branch);

  if (!result.success) {
    throw new AppError(result.error || 'Failed to clone repository', 400, 'CLONE_ERROR');
  }

  res.json({ success: true, data: { path: result.path } });
});

// Push to GitHub
router.post('/push', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = pushSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { workingDirectory, remote, branch, force } = parsed.data;
  const result = await githubService.pushToGitHub(userId, workingDirectory, remote, branch, force);

  if (!result.success) {
    throw new AppError(result.error || 'Failed to push to GitHub', 400, 'PUSH_ERROR');
  }

  res.json({ success: true });
});

// Add remote
router.post('/remote', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = addRemoteSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { workingDirectory, remoteName, repoUrl } = parsed.data;
  const result = await githubService.addRemote(userId, workingDirectory, remoteName, repoUrl);

  if (!result.success) {
    throw new AppError(result.error || 'Failed to add remote', 400, 'REMOTE_ERROR');
  }

  res.json({ success: true });
});

// Get rate limit status
router.get('/rate-limit', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const status = await githubService.getRateLimitStatus(userId);

  if (!status) {
    throw new AppError('Failed to get rate limit status', 401, 'GITHUB_AUTH_ERROR');
  }

  res.json({ success: true, data: status });
});

export default router;
