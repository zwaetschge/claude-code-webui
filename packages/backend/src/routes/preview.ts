import { Router } from 'express';
import { config } from '../config';

const router = Router();

router.get('/config', (_req, res) => {
  res.json({
    enabled: Boolean(config.previewHostname),
    hostname: config.previewHostname ?? null,
  });
});

export default router;
